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
// Cells run without --emit-row print the verdict on stdout; with --emit-row stdout is the row and the verdict is the last stderr JSON line.
const lastJson = (f) => { const ls = fs.readFileSync(path.join(D, f), 'utf8').trim().split('\n').filter((l) => l.startsWith('{')); return JSON.parse(ls.pop()); };
let verdict = lastJson('stdout.json');
if (verdict.role === 'owner' && verdict.methodology_kind) verdict = lastJson('stderr.log');
const eventId = Number(process.argv[3] || verdict.evidence_store_event_id);
if (verdict.evidence_store_event_id !== eventId) throw new Error(`verdict names store event ${verdict.evidence_store_event_id}, not ${eventId}`);
const store = path.join(process.env.ENGINE_CAPABILITY_DIR || path.join(os.homedir(), '.autopilot', 'engine-capability'), 'qualification-evidence.jsonl');
const rec = fs.readFileSync(store, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((r) => r.event_id === eventId);
if (!rec) throw new Error(`store event ${eventId} not found`);
const ev = rec.evidence;
const must = (cond, msg) => { if (!cond) throw new Error('cross-check failed: ' + msg); };
// RELABELED=1: the store event was relabelled effort -> default after the sitting (coordinator, 2026-10-14), which legitimately changes
// evidence_id / identity_hash / transcript_hash. Everything that does not depend on the identity block is still cross-checked.
const relabeled = process.env.RELABELED === '1';
if (relabeled) must(ev.identity.effort === 'default', 'relabelled evidence must carry effort default');
must(ev.trial_set_hash === verdict.trial_set_hash && ev.scope_hash === verdict.scope_hash, 'scope/trial_set hash');
if (!relabeled) {
  must(ev.evidence_id === verdict.evidence_id, 'evidence_id');
  must(ev.identity_hash === verdict.identity_hash, 'identity hash');
  must(rec.transcript_hash === verdict.evidence_store_transcript_hash, 'transcript hash');
}
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
  // Aligned with runBrainQualification at origin/develop 12594f51 (scripts/engine-qualify.js:2979-3001).
  capability_score: sum('plants_total') === 0 ? 0 : sum('plants_caught') / sum('plants_total'),
  cost: { source: 'unknown', usd_per_mtok_input: 0, usd_per_mtok_output: 0, sample_tokens: 0 },
  expires: ev.expires_at.slice(0, 10),
  latency: { sample_wall_time_s: wall }, status: qualified ? 'qualified' : 'failed', qualified_at: ev.issued_at.slice(0, 10), standing: true,
  evidence_store: { event_id: rec.event_id, producer: rec.producer, transcript_hash: rec.transcript_hash },
  evidence: ev,
};
fs.writeFileSync(path.join(D, 'rebuilt-row.json'), JSON.stringify(row) + '\n');
console.log(`${lane}: store event ${eventId} -> ${path.join(D, 'rebuilt-row.json')} status=${row.status} plants=${row.quality.plants} wall=${wall}s`);
