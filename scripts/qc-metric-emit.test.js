'use strict';
// Tests for qc-metric-emit.js — the additive P2.1 QC-event emitter.
// Run: node --test scripts/qc-metric-emit.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const emit = require('./qc-metric-emit.js');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-emit-'));
  return path.join(dir, 'events.jsonl');
}

const validEvent = {
  change_id: 'c1',
  repo: 'demo',
  base_sha: 'b',
  head_sha: 'h',
  timestamp: '2026-07-02T00:00:00Z',
  lenses: ['correctness'],
  panel_verdict: 'pass',
  findings: [
    { id: 'x', severity: 'high', lens: 'correctness', verified: 'real', caught_at_stage: 'publish_hetero_review' },
  ],
};

test('emit writes a valid event as one JSONL line', () => {
  const store = tmpStore();
  emit.emit(store, validEvent);
  const lines = fs.readFileSync(store, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.change_id, 'c1');
  // keys are sorted for stable diffs
  assert.deepEqual(Object.keys(parsed), Object.keys(parsed).slice().sort());
});

test('emit appends (append-only, does not truncate)', () => {
  const store = tmpStore();
  emit.emit(store, { ...validEvent, change_id: 'a' });
  emit.emit(store, { ...validEvent, change_id: 'b' });
  const ids = fs.readFileSync(store, 'utf8').trim().split('\n').map((l) => JSON.parse(l).change_id);
  assert.deepEqual(ids, ['a', 'b']);
});

test('validateEvent rejects bad verdict enum', () => {
  assert.throws(() => emit.validateEvent({ ...validEvent, panel_verdict: 'maybe' }), emit.SchemaError);
});

test('validateEvent rejects bad finding stage', () => {
  const bad = { ...validEvent, findings: [{ ...validEvent.findings[0], caught_at_stage: 'later' }] };
  assert.throws(() => emit.validateEvent(bad), emit.SchemaError);
});

test('validateEvent rejects missing required field', () => {
  const bad = { ...validEvent };
  delete bad.repo;
  assert.throws(() => emit.validateEvent(bad), emit.SchemaError);
});

test('resolveStore precedence: --store > env > null', () => {
  assert.equal(emit.resolveStore({ store: '/a' }, { QC_METRIC_STORE: '/b' }), '/a');
  assert.equal(emit.resolveStore({}, { QC_METRIC_STORE: '/b' }), '/b');
  assert.equal(emit.resolveStore({}, {}), null);
});

test('buildEvent assembles from flags incl. lenses split', () => {
  const ev = emit.buildEvent({
    'change-id': 'cf', repo: 'codeforge', 'base-sha': 'B', 'head-sha': 'H',
    verdict: 'pass', stage: 'depth0_panel', lenses: 'rust, concurrency',
    findings: JSON.stringify(validEvent.findings),
  });
  assert.deepEqual(ev.lenses, ['rust', 'concurrency']);
  assert.equal(ev.verdict_stage, 'depth0_panel');
  emit.validateEvent(ev); // must be schema-valid
});

test('buildEvent defaults verdict_stage to depth0_panel (lone partial-delta safe)', () => {
  // a publish-stage escape emitted WITHOUT --stage keeps the gate at depth0_panel, so the
  // finding at publish_hetero_review is later than the gate → counts as an escape even
  // when no depth0 record co-exists in the store.
  const ev = emit.buildEvent({
    'change-id': 'cf', repo: 'codeforge', 'base-sha': 'B', 'head-sha': 'H',
    verdict: 'pass',
    findings: JSON.stringify([{ id: 'mtime', severity: 'medium', lens: 'data-integrity', verified: 'real', caught_at_stage: 'publish_hetero_review' }]),
  });
  assert.equal(ev.verdict_stage, 'depth0_panel');
  emit.validateEvent(ev);
});

test('main is a no-op (exit 0) when no store configured', () => {
  const errs = [];
  const rc = emit.main(['--change-id', 'c', '--repo', 'r'], {}, () => {}, (s) => errs.push(s));
  assert.equal(rc, 0);
  assert.match(errs.join('\n'), /no-op/);
});

test('main appends a full --event and exits 0', () => {
  const store = tmpStore();
  const rc = emit.main(['--store', store, '--event', JSON.stringify(validEvent)], {}, () => {}, () => {});
  assert.equal(rc, 0);
  assert.equal(fs.readFileSync(store, 'utf8').trim().split('\n').length, 1);
});

test('main returns 2 on schema-invalid event and writes nothing', () => {
  const store = tmpStore();
  const bad = JSON.stringify({ ...validEvent, panel_verdict: 'nope' });
  const rc = emit.main(['--store', store, '--event', bad], {}, () => {}, () => {});
  assert.equal(rc, 2);
  assert.equal(fs.existsSync(store), false);
});
