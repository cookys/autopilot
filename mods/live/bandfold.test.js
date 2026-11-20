// mods/live/bandfold.test.js — the band fold decisions (default collapsed, one click, new-card mark).
// Pure: imports bandfold.ts. Run: node --test mods/live/bandfold.test.js (also run by run-tests.sh).
// These assertions are red on the old register.ts (bandCollapsed starts false; a click only toggles when the d label is pressed; a new card has no mark).
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let F
test.before(async () => {
  F = await import(path.join(__dirname, 'bandfold.ts'))
})

const fold = (collapsed, menu) => ({ collapsed, menu })

test('initialBandCollapsed: the band starts as one row', () => {
  assert.equal(F.initialBandCollapsed(), true)
})

test('toggleBand: a click on the collapsed row expands; d on the expanded band collapses; blank space does not', () => {
  const start = fold(F.initialBandCollapsed(), 'd')
  assert.deepEqual(start, fold(true, 'd'))
  const open = F.toggleBand(start, 'row')
  assert.deepEqual(open, fold(false, 'd'))
  const shut = F.toggleBand(open, 'd')
  assert.deepEqual(shut, fold(true, 'd'))
  // the d label is not the only target: a menu label on the collapsed row also expands
  assert.deepEqual(F.toggleBand(shut, 'r'), fold(false, 'r'))
  // negative control: blank space in the expanded band changes nothing
  const expanded = fold(false, 'd')
  assert.equal(F.toggleBand(expanded, 'blank'), expanded)
  assert.deepEqual(F.toggleBand(expanded, 'blank'), expanded)
  // a row-body click while expanded is the same blank: it does not collapse
  assert.equal(F.toggleBand(expanded, 'row'), expanded)
  // d collapses only when that menu is already showing
  assert.deepEqual(F.toggleBand(fold(false, 'r'), 'd'), fold(false, 'd'))
})

test('toggleFold: flips collapsed both ways and keeps menu', () => {
  const shut = fold(true, 'r')
  const open = F.toggleFold(shut)
  assert.deepEqual(open, fold(false, 'r'))
  assert.notEqual(open, shut)
  const back = F.toggleFold(open)
  assert.deepEqual(back, fold(true, 'r'))
  assert.deepEqual(F.toggleFold(fold(false, 'd')), fold(true, 'd'))
  assert.deepEqual(F.toggleFold(fold(true, 'u')), fold(false, 'u'))
})

test('foldPlace: columns 1..120 keep the toggle out of the close room and off the body', () => {
  const closeRoom = 4
  for (let columns = 1; columns <= 120; columns++) {
    const place = F.foldPlace(columns, closeRoom)
    const pad = place.pad ? 1 : 0
    const toggle = place.toggleCol === null ? 0 : 1
    const end = place.body + pad + toggle
    const roomAt = Math.max(0, columns - closeRoom)
    assert.ok(place.body >= 0, 'body width at ' + columns)
    assert.ok(end <= roomAt, 'body + padding + toggle stay out of the close room at ' + columns)
    if (place.toggleCol === null) {
      assert.equal(place.pad, false)
      assert.equal(place.body, 0)
    } else {
      assert.equal(place.toggleCol, columns - closeRoom - 1, 'toggle column at ' + columns)
      assert.ok(place.toggleCol + 1 <= columns - closeRoom, 'toggle ends before the close room at ' + columns)
      assert.ok(place.body + pad <= place.toggleCol, 'body and padding do not cover the toggle at ' + columns)
      assert.equal(place.body + pad, place.toggleCol, 'no gap and no overlap at ' + columns)
    }
  }
  // columns 6 is the case Math.max(1, …) used to push one body cell onto the toggle
  const narrow = F.foldPlace(6, closeRoom)
  assert.deepEqual(narrow, { body: 0, pad: true, toggleCol: 1 })
  assert.deepEqual(F.foldPlace(5, closeRoom), { body: 0, pad: false, toggleCol: 0 })
  assert.deepEqual(F.foldPlace(4, closeRoom), { body: 0, pad: false, toggleCol: null })
})

test('collapsedRowMark: a count that grew while collapsed is marked; expanding (seen catches up) clears it', () => {
  assert.equal(F.collapsedRowMark(1, 1), false)
  assert.equal(F.collapsedRowMark(1, 2), true)
  assert.equal(F.collapsedRowMark(2, 2), false)
  assert.equal(F.collapsedRowMark(2, 1), false)
})
