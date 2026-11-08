#!/usr/bin/env node
'use strict';

require('./lib/test-git-env');
// # RED at d91ec0a3e: priorExamEvidenceId is not a function (and a failed retake on a newer harness build throws "invalid supersedes target" at append).

// A failed retake of an identity that already has a qualified row is real evidence and must be
// stored. The binding guard in evaluateCapabilityEvidence ("restrictive evidence ... is not bound
// to the active qualification") stays: an UNLINKED restrictive row is still refused.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ce = require('../src/engine/capability-evidence');
const { appendEvidenceRecord } = require('./engine-capability-state');
const { priorExamEvidenceId } = require('./engine-qualify');

const digestX = (c) => c.repeat(64);
const scope = {
  task_classes: ['bounded_implementation'], domains: ['repository'], languages: ['en'],
  tool_surface: ['git_commit'],
};
const identity = (harness) => ({
  identity: 'm', model_alias: 'm', model_version: 'v', family: 'f', runner: 'grok',
  runner_version: '1', harness_version: harness, effort: 'high', prompt_config_hash: digestX('a'),
  semantic_fingerprint: digestX('b'), containment_fingerprint: digestX('c'), identity_resolved: true,
});
const trial = (id, total, passed, at) => ({
  trial_id: id, observed_at: at, corpus_manifest_hash: digestX('d'),
  cases_total: total, cases_passed: passed, integrity_violations: 0, fabricated_changes: 0,
  contract_violations: 0, oracle_misses: 0, family_lines_hash: digestX('e'), dispatch_ledger_hash: digestX('f'),
});
function record(state, harness, at, supersedes) {
  const passed = state === 'qualified' ? 12 : 5;
  return {
    schema_version: 1, source: 'internal_eval', source_ref: 'engine-qualify:implementer-v1',
    state, role: 'implementer', scope, identity: identity(harness),
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retake-persist-'));
const config = {
  storeDir: dir,
  evidenceFile: path.join(dir, 'qualification-evidence.jsonl'),
  lockFile: path.join(dir, '.lock'),
};
const T1 = '2026-11-08T00:00:00.000Z';
const T2 = '2026-11-09T00:00:00.000Z';
const T3 = '2026-11-09T06:00:00.000Z';
const PRODUCER = 'engine-qualify-v2';

const qualified = ce.compileCapabilityEvidence(record('qualified', 'h1', T1, null));
appendEvidenceRecord(config, qualified, PRODUCER);

// The exact value engine-qualify now feeds into `supersedes`, found across a harness bump.
const priorId = priorExamEvidenceId(dir, 'implementer', scope, identity('h2'));
assert.strictEqual(priorId, qualified.evidence_id, 'retake on a newer harness chains to the qualified row');

// 1. A failed retake chained to the qualification is stored with its own event id.
const failed = ce.compileCapabilityEvidence(record('degraded', 'h2', T2, priorId));
const written = appendEvidenceRecord(config, failed, PRODUCER);
assert.ok(written.event_id > 1, 'failed retake got its own event id');
const rows = fs.readFileSync(config.evidenceFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
assert.strictEqual(rows.length, 2, 'both rows are in the store');
assert.strictEqual(rows[1].evidence.state, 'degraded');

// 2. The scorecard (evaluator) sees it under the existing bound-restriction rule.
const evaluated = ce.evaluateCapabilityEvidence(rows.map((r) => r.evidence), {
  role: 'implementer', scope, identity: identity('h2'), evaluation_time: T3,
});
assert.strictEqual(evaluated.state, 'degraded', 'bound degraded retake demotes the qualification');
assert.strictEqual(evaluated.evidence_id, failed.evidence_id);

// 3. Negative control: the guard still refuses a restrictive row that is NOT chained.
const unlinked = ce.compileCapabilityEvidence(record('degraded', 'h3', T3, null));
assert.throws(
  () => appendEvidenceRecord(config, unlinked, PRODUCER),
  /not bound to the active qualification/,
  'an unlinked restrictive row is still refused',
);
assert.strictEqual(
  fs.readFileSync(config.evidenceFile, 'utf8').trim().split('\n').length, 2,
  'refused row left the store unchanged',
);

// 4. A different exam identity never links (supersedes across exams stays invalid).
const other = record('degraded', 'h3', T3, qualified.evidence_id);
other.identity = { ...other.identity, effort: 'low' };
assert.throws(
  () => appendEvidenceRecord(config, ce.compileCapabilityEvidence(other), PRODUCER),
  /invalid supersedes target/,
  'supersedes across different exams is refused',
);

fs.rmSync(dir, { recursive: true, force: true });
console.log('engine-qualify-retake-persist: ok');
