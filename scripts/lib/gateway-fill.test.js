'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readGatewayFill, allocate, auditLine } = require('./gateway-fill.js');

function makeFill(now, overrides = {}) {
  return {
    schema: 'capacity.gateway-fill/1',
    generated_at: now.toISOString(),
    backends: [
      { name: 'resident', free: 6, in_use: 7, queue_depth: 0, cap_effective: 13, state: 'serving', eligible: true, quota: 2, reason: 'ok' },
      { name: 'burst', free: 4, in_use: 0, queue_depth: 0, cap_effective: 4, state: 'serving', eligible: true, quota: 2, reason: 'ok' },
    ],
    total_quota: 4,
    ...overrides,
  };
}

test('readGatewayFill handles valid, missing, unreadable, bad_schema, and stale files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-fill-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'gateway_fill.v1.json');
  const now = new Date('2026-11-23T13:30:03Z');
  const env = { AUTOPILOT_GATEWAY_FILL: file };

  // no_file
  assert.deepEqual(readGatewayFill({ env, now }), { ok: false, reason: 'no_file' });

  // unreadable (directory at file path)
  const dirAsFile = path.join(dir, 'as-dir');
  fs.mkdirSync(dirAsFile);
  assert.deepEqual(readGatewayFill({ env: { AUTOPILOT_GATEWAY_FILL: dirAsFile }, now }), { ok: false, reason: 'unreadable' });

  // valid
  const valid = makeFill(now);
  fs.writeFileSync(file, JSON.stringify(valid));
  assert.deepEqual(readGatewayFill({ env, now }), { ok: true, data: valid });

  // bad_schema: missing schema
  fs.writeFileSync(file, JSON.stringify({ ...valid, schema: undefined }));
  assert.deepEqual(readGatewayFill({ env, now }), { ok: false, reason: 'bad_schema' });

  // bad_schema: unparseable generated_at
  fs.writeFileSync(file, JSON.stringify({ ...valid, generated_at: 'not-a-date' }));
  assert.deepEqual(readGatewayFill({ env, now }), { ok: false, reason: 'bad_schema' });

  // bad_schema: negative quota
  fs.writeFileSync(file, JSON.stringify({
    ...valid,
    backends: [{ name: 'resident', eligible: true, quota: -1 }],
  }));
  assert.deepEqual(readGatewayFill({ env, now }), { ok: false, reason: 'bad_schema' });

  // bad_schema: fractional quota
  fs.writeFileSync(file, JSON.stringify({
    ...valid,
    backends: [{ name: 'resident', eligible: true, quota: 1.5 }],
  }));
  assert.deepEqual(readGatewayFill({ env, now }), { ok: false, reason: 'bad_schema' });

  // stale: 16 minutes old
  const sixteenMinAgo = new Date(now.getTime() - 16 * 60 * 1000);
  fs.writeFileSync(file, JSON.stringify(makeFill(sixteenMinAgo)));
  assert.deepEqual(readGatewayFill({ env, now }), { ok: false, reason: 'stale' });

  // stale: in the future
  const future = new Date(now.getTime() + 60 * 1000);
  fs.writeFileSync(file, JSON.stringify(makeFill(future)));
  assert.deepEqual(readGatewayFill({ env, now }), { ok: false, reason: 'stale' });
});

test('allocate prioritizes P1 over P2, earlier due first, respects quota, eligibility, maxPerRound, and skips non-cheap', () => {
  const fill = {
    schema: 'capacity.gateway-fill/1',
    generated_at: '2026-11-23T13:30:03Z',
    backends: [
      { name: 'ineligible-b', eligible: false, quota: 5 },
      { name: 'b1', eligible: true, quota: 2 },
      { name: 'b2', eligible: true, quota: 1 },
    ],
    total_quota: 10,
  };

  const ready = [
    { id: 't-p2-late', lane: 'l1', priority: 'P2', due: '2026-11-24T00:00:00Z', engineClass: 'cheap' },
    { id: 't-p2-null', lane: 'l1', priority: 'P2', due: null, engineClass: 'cheap' },
    { id: 't-expensive', lane: 'l1', priority: 'P1', due: '2026-11-23T01:00:00Z', engineClass: 'frontier' },
    { id: 't-p2-early', lane: 'l2', priority: 'P2', due: '2026-11-23T12:00:00Z', engineClass: 'cheap' },
    { id: 't-p1', lane: 'l3', priority: 'P1', due: null, engineClass: 'cheap' },
  ];

  const res = allocate({ fill, ready });
  assert.deepEqual(res.assignments, [
    { id: 't-p1', lane: 'l3', backend: 'b1' },
    { id: 't-p2-early', lane: 'l2', backend: 'b1' },
    { id: 't-p2-late', lane: 'l1', backend: 'b2' },
  ]);
  assert.deepEqual(res.skipped, [
    { id: 't-expensive', reason: 'not_cheap' },
    { id: 't-p2-null', reason: 'no_quota' },
  ]);

  // maxPerRound limit
  const capped = allocate({ fill, ready, maxPerRound: 2 });
  assert.equal(capped.assignments.length, 2);
  assert.deepEqual(capped.skipped, [
    { id: 't-expensive', reason: 'not_cheap' },
    { id: 't-p2-late', reason: 'no_quota' },
    { id: 't-p2-null', reason: 'no_quota' },
  ]);

  // empty ready
  assert.deepEqual(allocate({ fill, ready: [] }), { assignments: [], skipped: [] });
});

test('allocate follows capacity rules: resident excluded, most remaining first with glm on ties, flashnext-b capped at 3', () => {
  const fill = {
    backends: [
      { name: 'resident', eligible: true, quota: 11 },
      { name: 'flashnext-b', eligible: true, quota: 5 },
      { name: 'glm', eligible: true, quota: 4 },
    ],
    total_quota: 20,
  };
  const ready = Array.from({ length: 9 }, (_, i) => ({ id: 't' + i, lane: 'l', priority: 'P2', due: null, engineClass: 'cheap' }));
  const res = allocate({ fill, ready });
  assert.deepEqual(res.assignments.map((a) => a.backend), [
    'glm', 'glm', 'flashnext-b', 'glm', 'flashnext-b', 'glm', 'flashnext-b',
  ]);
  assert.deepEqual(res.skipped, [{ id: 't7', reason: 'no_quota' }, { id: 't8', reason: 'no_quota' }]);
  assert.equal(res.assignments.some((a) => a.backend === 'resident'), false);

  // Overrides: nothing excluded and no caps gives resident the most room.
  const open = allocate({ fill, ready: ready.slice(0, 1), exclude: [], caps: {} });
  assert.equal(open.assignments[0].backend, 'resident');
});

test('auditLine formats single-line dispatch record without brief', () => {
  const line = auditLine({ id: 't-1', lane: 'autopilot', backend: 'resident' }, 'run-1', '2026-11-23T13:30:03.000Z');
  assert.equal(line, 'gateway-fill dispatch id=t-1 lane=autopilot backend=resident ts=2026-11-23T13:30:03.000Z');
});
