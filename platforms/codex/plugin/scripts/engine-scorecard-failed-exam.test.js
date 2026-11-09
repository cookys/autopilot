#!/usr/bin/env node
'use strict';

require('./lib/test-git-env');
// # RED at ce53a6f37: case A printed admission_status "qualified" (the older pass) after a newer degraded exam.

// The newest exam of a seat identity decides standing. A failed/degraded retake is persisted as
// evidence by engine-qualify (no scorecard row), and findSeatBaseline skips non-qualified rows, so
// seat-status kept reporting the older pass. Temp stores only; never ~/.autopilot.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ce = require('../src/engine/capability-evidence');
const { appendEvidenceRecord } = require('./engine-capability-state');

const SC = path.join(__dirname, 'engine-scorecard.js');
const digestX = (c) => c.repeat(64);
const scope = {
  task_classes: ['bounded_implementation'], domains: ['repository'], languages: ['en'],
  tool_surface: ['git_commit'],
};
const identity = (effort) => ({
  identity: 'm', model_alias: 'm', model_version: 'v', family: 'f', runner: 'grok',
  runner_version: '1', harness_version: 'h1', effort, prompt_config_hash: digestX('a'),
  semantic_fingerprint: digestX('b'), containment_fingerprint: digestX('c'), identity_resolved: true,
});
const trial = (id, total, passed, at) => ({
  trial_id: id, observed_at: at, corpus_manifest_hash: digestX('d'),
  cases_total: total, cases_passed: passed, integrity_violations: 0, fabricated_changes: 0,
  contract_violations: 0, oracle_misses: 0, family_lines_hash: digestX('e'), dispatch_ledger_hash: digestX('f'),
});
function record(state, effort, at, supersedes) {
  const passed = state === 'qualified' ? 12 : 5;
  return {
    schema_version: 1, source: 'internal_eval', source_ref: 'engine-qualify:implementer-v1',
    state, role: 'implementer', scope, identity: identity(effort),
    issued_at: at, observed_at: at,
    methodology: {
      kind: 'impl_dispatch', name: 'impl-live-rail', version: '1.0.0',
      corpus_version: 'impl-live-rail-v1.impl-live-rail-v1', corpus_manifest_hash: digestX('d'),
      thresholds: {
        min_trials: 2, max_integrity_violations: 0, max_fabricated_changes: 0,
        max_contract_violations: 0, max_oracle_misses: 0,
      },
      basis: null,
    },
    trials: [trial('trial-1', 12, passed, at), trial('trial-2', 12, passed, at)],
    revocation: null, supersedes,
  };
}

function fixture(evidenceSteps, passDates) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'failed-exam-'));
  const cap = path.join(root, 'cap');
  const sc = path.join(root, 'sc');
  fs.mkdirSync(cap); fs.mkdirSync(sc);
  const config = {
    storeDir: cap, evidenceFile: path.join(cap, 'qualification-evidence.jsonl'), lockFile: path.join(cap, '.lock'),
  };
  const lastByEffort = {};
  for (const [state, effort, at] of evidenceSteps) {
    const ev = ce.compileCapabilityEvidence(record(state, effort, at, lastByEffort[effort] || null));
    appendEvidenceRecord(config, ev, 'engine-qualify-v2');
    lastByEffort[effort] = ev.evidence_id;
  }
  const rows = passDates.map((d, i) => JSON.stringify({
    event_id: i + 1, engine: 'm', runner: 'grok', role: 'implementer', effort: 'high',
    status: 'qualified', qualified_at: d, date: d, capability_score: 1, family: 'f',
    cost: { source: 'unknown' }, model_version: 'v', corpus_version: 'c', harness_version: 'h',
    runner_version: 'r', prompt_config_hash: 'p',
  }));
  fs.writeFileSync(path.join(sc, 'scorecard.jsonl'), `${rows.join('\n')}\n`);
  return { root, cap, sc };
}

function seatStatus(fx, effort = 'high', extra = []) {
  const res = spawnSync(process.execPath, [
    SC, 'seat-status', '--engine', 'm', '--runner', 'grok', '--role', 'implementer',
    '--effort', effort, '--now', '2026-11-12T00:00:00Z', ...extra,
  ], {
    encoding: 'utf8',
    env: { ...process.env, ENGINE_SCORECARD_DIR: fx.sc, ENGINE_CAPABILITY_DIR: fx.cap, AUTOPILOT_STRIKE_ENFORCEMENT: 'enforce' },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

const cleanup = [];
const mk = (...a) => { const fx = fixture(...a); cleanup.push(fx.root); return fx; };

// A. pass, then a newer degraded exam of the same seat -> not qualified, names the exam.
{
  const fx = mk([['qualified', 'high', '2026-11-08T01:00:00.000Z'], ['degraded', 'high', '2026-11-09T01:00:00.000Z']], ['2026-11-08']);
  const s = seatStatus(fx);
  assert.strictEqual(s.admission_status, 'requalify_required', 'A: newer degraded exam demotes');
  assert.strictEqual(s.newer_failed_exam.state, 'degraded');
  assert.strictEqual(s.newer_failed_exam.evidence_event_id, 2);
  assert.strictEqual(s.baseline_event_id, 1, 'A: baseline still names the old pass');
  assert.strictEqual(s.strikes_since_pass, 0, 'A: no strike row is invented');
  // A2. shadow strike enforcement does not hide a failed exam.
  const res = spawnSync(process.execPath, [SC, 'seat-status', '--engine', 'm', '--runner', 'grok', '--role', 'implementer',
    '--effort', 'high', '--now', '2026-11-12T00:00:00Z'], {
    encoding: 'utf8', env: { ...process.env, ENGINE_SCORECARD_DIR: fx.sc, ENGINE_CAPABILITY_DIR: fx.cap, AUTOPILOT_STRIKE_ENFORCEMENT: 'shadow' },
  });
  assert.strictEqual(JSON.parse(res.stdout).admission_status, 'requalify_required', 'A2: shadow mode only opts out of strikes');
}

// B. pass, degraded, newer pass (scorecard row recorded) -> qualified again.
{
  const fx = mk([['qualified', 'high', '2026-11-08T01:00:00.000Z'], ['degraded', 'high', '2026-11-09T01:00:00.000Z'],
    ['qualified', 'high', '2026-11-10T01:00:00.000Z']], ['2026-11-08', '2026-11-10']);
  const s = seatStatus(fx);
  assert.strictEqual(s.admission_status, 'qualified', 'B: a later pass restores');
  assert.strictEqual(s.newer_failed_exam, undefined);
}

// B2. the later pass exists only as evidence (record step not run) -> newest exam is a pass -> qualified.
{
  const fx = mk([['qualified', 'high', '2026-11-08T01:00:00.000Z'], ['degraded', 'high', '2026-11-09T01:00:00.000Z'],
    ['qualified', 'high', '2026-11-10T01:00:00.000Z']], ['2026-11-08']);
  assert.strictEqual(seatStatus(fx).admission_status, 'qualified', 'B2: newest exam is a pass');
}

// C. a degraded exam of a different effort never touches this seat.
{
  const fx = mk([['qualified', 'high', '2026-11-08T01:00:00.000Z'], ['qualified', 'low', '2026-11-08T02:00:00.000Z'],
    ['degraded', 'low', '2026-11-09T01:00:00.000Z']], ['2026-11-08']);
  assert.strictEqual(seatStatus(fx, 'high').admission_status, 'qualified', 'C: other effort has no effect');
}

// D. a degraded exam OLDER than the recorded pass does not demote.
{
  const fx = mk([['qualified', 'high', '2026-11-06T01:00:00.000Z'], ['degraded', 'high', '2026-11-07T01:00:00.000Z']], ['2026-11-08']);
  assert.strictEqual(seatStatus(fx).admission_status, 'qualified', 'D: older degraded exam is history');
}

// E. no time-based decay: far-future clock, newest exam still passed -> still qualified.
{
  const fx = mk([['qualified', 'high', '2026-11-08T01:00:00.000Z']], ['2026-11-08']);
  assert.strictEqual(seatStatus(fx).admission_status, 'qualified', 'E: pass only');
}

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
console.log('engine-scorecard-failed-exam: ok');
