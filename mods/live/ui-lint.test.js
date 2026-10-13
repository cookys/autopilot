// mods/live/ui-lint.test.js — L3 of the live pane design system (docs/plans/2026-10-13-live-pane-design-system.md, I5 (a) and I20).
// Imports the REAL ui.ts (erasable syntax only, so Node strips the types) and lints its glyph tables; the planted-table cases are the
// negative controls (M7 to M10): each broken table must be reported, so a checker that goes quiet turns this suite red.
// Run: node --test mods/live/ui-lint.test.js   (also run by run-tests.sh)
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let ui
test.before(async () => {
  ui = await import(path.join(__dirname, 'ui.ts'))
})

const clone = () => JSON.parse(JSON.stringify(ui.GLYPHS))

test('L3: the real glyph tables have no emoji hazard and every new glyph carries a verified entry', () => {
  assert.deepEqual(ui.glyphTableViolations(ui.GLYPHS), [])
})

test('L3: the real glyph tables keep one glyph to one meaning', () => {
  assert.deepEqual(ui.vocabularyViolations(ui.GLYPHS), [])
})

test('L3: every new-to-vocabulary glyph is recorded, and none is claimed verified before the owner ran glyph-check', () => {
  for (const g of ui.NEW_GLYPHS) assert.equal(typeof ui.GLYPHS.verified[g], 'string', 'verified entry for ' + g)
  for (const g of ui.NEW_GLYPHS) assert.equal(ui.GLYPHS.verified[g], 'pending-owner', g + ' stays pending-owner until the owner runs the check')
})

test('M7 control: stalled = the emoji-prone pause glyph is reported', () => {
  const g = clone()
  g.state.stalled = '⏸'
  const v = ui.glyphTableViolations(g)
  assert.ok(v.some(x => x.includes('⏸')), JSON.stringify(v))
})

test('M8 control: a line containing the gear glyph is reported', () => {
  assert.ok(ui.emojiViolations('● 2 ⚙ jobs').length > 0)
  assert.deepEqual(ui.emojiViolations('● 2 jobs'), [])
})

test('M9 control: a keycap sequence is reported; plain digits, # and * stay legal', () => {
  assert.ok(ui.emojiViolations('1️⃣').length >= 2)
  assert.ok(ui.emojiViolations('1⃣').length >= 1)
  assert.deepEqual(ui.emojiViolations('0123456789 # *'), [])
})

test('M10 control: a state glyph also in the structure table is reported', () => {
  const g = clone()
  g.structure.bullet = '●'
  const v = ui.vocabularyViolations(g)
  assert.ok(v.some(x => x.includes('●')), JSON.stringify(v))
})

test('control: a new glyph without a verified entry is reported', () => {
  const g = clone()
  delete g.verified['⊘']
  assert.ok(ui.glyphTableViolations(g).some(x => x.includes('⊘')))
})

test('control: two states sharing one glyph are reported', () => {
  const g = clone()
  g.state.failed = g.state.done
  assert.ok(ui.vocabularyViolations(g).length > 0)
})
