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

test('collapsedRowMark: a count that grew while collapsed is marked; expanding (seen catches up) clears it', () => {
  assert.equal(F.collapsedRowMark(1, 1), false)
  assert.equal(F.collapsedRowMark(1, 2), true)
  assert.equal(F.collapsedRowMark(2, 2), false)
  assert.equal(F.collapsedRowMark(2, 1), false)
})
