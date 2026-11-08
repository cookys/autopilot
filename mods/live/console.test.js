// mods/live/console.test.js — the operator-console snapshot half (console.ts): the fleet.console/1 parser as a trust boundary and the
// .claude/console.json mode reader. No UI, no rendering: it pins what survives the parse, what is dropped, and what never crosses into
// the result (the planted lead address and host ip in fixtures/console/leak.json). The producer's official C0 fixtures
// (fixtures/console/c0/, byte-for-byte copies, fixed clock NOW = 1794200000000) pin the real schema: the nullable lead_display and
// at_ms, the item to_console and answerable_by, and the quota counts.
// Imports the REAL console.ts (erasable syntax only, so Node strips the types). Run: node --test mods/live/console.test.js   (also run by run-tests.sh)
// Negative controls: every planted-bad-input case expects null or a drop; a mutation of console.ts (the mode check widened to any mode,
// an extra field copied through) turns this file red.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let C
test.before(async () => {
  C = await import(path.join(__dirname, 'console.ts'))
})

const FIX = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'console', name), 'utf8')
const RAW = name => JSON.parse(FIX(name))
const PARSE = name => C.parseConsole(FIX(name))
const C0 = name => FIX('c0/' + name)
const RAWC0 = name => JSON.parse(C0(name))
const PARSEC0 = name => C.parseConsole(C0(name))
// the parser fills quota_risk 0 and summary.quota_worst null when absent, so compare the raw counts with the same defaults
const expectedCounts = raw => ({
  decisions: raw.counts.decisions ?? 0,
  exceptions: raw.counts.exceptions ?? 0,
  quota_risk: raw.counts.quota_risk ?? 0,
  tabs: raw.counts.tabs ?? {},
  summary: {
    lines: raw.counts.summary.lines ?? {},
    hosts: raw.counts.summary.hosts ?? {},
    hints: raw.counts.summary.hints ?? 0,
    quota_worst: raw.counts.summary.quota_worst ?? null,
  },
})

test('good fixtures: each parses to a snapshot, keeps every item and card, and the counts equal the fixture numbers', () => {
  for (const name of ['normal.json', 'empty.json', 'stale.json', 'no-source.json', 'leak.json']) {
    const raw = RAW(name)
    const got = PARSE(name)
    assert.notEqual(got, null, name)
    assert.equal(got.items.length, raw.items.length, name + ': items kept')
    assert.equal(got.cards.length, raw.cards.length, name + ': cards kept')
    assert.deepEqual(got.counts, expectedCounts(raw), name + ': counts')
  }
  assert.equal(PARSE('no-source.json').lines, null, 'no lines key is null (no source), not an empty list')
})

test('null cases: a foreign schema, non-JSON text, empty text, a missing counts, a non-object counts and non-array items never throw, all null', () => {
  assert.equal(PARSE('bad-schema.json'), null, 'schema fleet.console/0')
  assert.equal(C.parseConsole('{'), null, 'not JSON')
  assert.equal(C.parseConsole(''), null, 'empty string')
  assert.equal(C.parseConsole(JSON.stringify({ schema: 'fleet.console/1', items: [] })), null, 'counts missing')
  assert.equal(C.parseConsole(JSON.stringify({ schema: 'fleet.console/1', counts: [], items: [] })), null, 'counts not an object')
  assert.equal(C.parseConsole(JSON.stringify({ schema: 'fleet.console/1', counts: {}, items: 'no' })), null, 'items not an array')
  assert.equal(C.parseConsole(JSON.stringify([1, 2])), null, 'top level an array')
})

test('type drops: an item whose severity is the string "1" is dropped, every other item is kept', () => {
  const raw = JSON.parse(FIX('normal.json'))
  const badId = raw.items[0].id
  raw.items[0] = { ...raw.items[0], severity: '1' }
  const got = C.parseConsole(JSON.stringify(raw))
  assert.notEqual(got, null)
  assert.equal(got.items.length, raw.items.length - 1)
  assert.ok(!got.items.some(i => i.id === badId), 'the string-severity item is gone')
  for (const it of raw.items.slice(1)) assert.ok(got.items.some(g => g.id === it.id), 'kept: ' + it.id)
})

const C0_NAMES = ['console-full.json', 'console-empty.json', 'console-stale.json', 'console-since.json', 'console-filtered-line-gpu.json']

test('c0 official fixtures: every file parses non-null and keeps every item, card and line', () => {
  for (const name of C0_NAMES) {
    const raw = RAWC0(name)
    const got = PARSEC0(name)
    assert.notEqual(got, null, name)
    assert.equal(got.items.length, raw.items.length, name + ': items kept')
    assert.equal(got.cards.length, raw.cards.length, name + ': cards kept')
    assert.equal(got.lines.length, raw.lines.length, name + ': lines kept')
  }
})

test('c0 console-full: the unassigned line is kept with lead_display null, to_console is a boolean only on exception and quota items, and the waiting_step card item is answerable_by report', () => {
  const got = PARSEC0('console-full.json')
  const un = got.lines.find(l => l.line_id === 'unassigned')
  assert.ok(un, 'the unassigned line is kept')
  assert.equal(un.lead_display, null)
  for (const it of got.items) {
    if (it.kind === 'exception' || it.kind === 'quota') assert.equal(typeof it.to_console, 'boolean', it.id + ': to_console boolean')
    else assert.equal(it.to_console, null, it.id + ': to_console null')
  }
  const ws = got.cards.find(c => c.status === 'waiting_step')
  assert.ok(ws, 'the waiting_step card')
  const wsItem = got.items.find(i => i.id === 'card:' + ws.id)
  assert.ok(wsItem, 'the waiting_step card item')
  assert.deepEqual(wsItem.answerable_by, ['report'])
})

test('c0 console-stale: the no_source sources quota_forecast, slots and metrics are kept with at_ms null', () => {
  const got = PARSEC0('console-stale.json')
  for (const name of ['quota_forecast', 'slots', 'metrics']) {
    assert.ok(got.sources[name], name + ' kept')
    assert.equal(got.sources[name].state, 'no_source', name)
    assert.equal(got.sources[name].at_ms, null, name + ' at_ms null')
  }
})

test('c0 console-full: counts.quota_risk and summary.quota_worst equal the raw values', () => {
  const raw = RAWC0('console-full.json')
  const got = PARSEC0('console-full.json')
  assert.equal(got.counts.quota_risk, raw.counts.quota_risk)
  assert.equal(got.counts.summary.quota_worst, raw.counts.summary.quota_worst)
})

test('c0 leak: the raw lead address and the host key planted in console-full.json never reach the parsed result', () => {
  const raw = RAWC0('console-full.json')
  assert.equal(typeof raw.lines[0].lead, 'string', 'the fixture plants the raw lead address')
  assert.equal(typeof raw.hosts[0].host_key, 'string', 'the fixture plants the host key')
  const out = JSON.stringify(PARSEC0('console-full.json'))
  assert.ok(!out.includes(raw.lines[0].lead), 'the member address leaked into the result')
  assert.ok(!out.includes(raw.hosts[0].host_key), 'the host key leaked into the result')
})

test('leak: the raw lead address and the host ip planted in leak.json never reach the parsed result', () => {
  const raw = RAW('leak.json')
  assert.equal(raw.lines[0].lead, 'nsx/hostx/fake-lead--claude', 'the fixture plants the raw address')
  assert.equal(raw.items.some(i => i.host_ip === '10.9.8.7'), true, 'the fixture plants the host ip')
  const out = JSON.stringify(PARSE('leak.json'))
  assert.ok(!out.includes('fake-lead'), 'the member address leaked into the result')
  assert.ok(!out.includes('10.9.8.7'), 'the host ip leaked into the result')
})

test('consoleModeOf: true only for the exact program object', () => {
  assert.equal(C.consoleModeOf(JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' })), true)
  for (const [label, text] of [
    ['another mode', JSON.stringify({ schema: 'autopilot.console/1', mode: 'off' })],
    ['another schema', JSON.stringify({ schema: 'autopilot.console/2', mode: 'program' })],
    ['mode missing', JSON.stringify({ schema: 'autopilot.console/1' })],
    ['null', null],
    ['not JSON', 'x'],
    ['top level an array', '[]'],
    ['top level a number', '123'],
  ]) assert.equal(C.consoleModeOf(text), false, label)
})
