// mods/live/console.test.js — the operator-console snapshot half (console.ts): the fleet.console/1 parser as a trust boundary and the
// .claude/console.json mode reader. No UI, no rendering: it pins what survives the parse, what is dropped, and what never crosses into
// the result (the planted lead address and host ip in fixtures/console/leak.json).
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

test('good fixtures: each parses to a snapshot, keeps every item and card, and the counts equal the fixture numbers', () => {
  for (const name of ['normal.json', 'empty.json', 'stale.json', 'no-source.json', 'leak.json']) {
    const raw = RAW(name)
    const got = PARSE(name)
    assert.notEqual(got, null, name)
    assert.equal(got.items.length, raw.items.length, name + ': items kept')
    assert.equal(got.cards.length, raw.cards.length, name + ': cards kept')
    assert.deepEqual(got.counts, raw.counts, name + ': counts')
  }
  assert.deepEqual(PARSE('no-source.json').lines, [], 'no lines key means no lines')
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
