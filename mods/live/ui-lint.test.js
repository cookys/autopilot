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
  for (const g of ui.NEW_GLYPHS) assert.ok(ui.verifiedOk(ui.GLYPHS.verified[g]), g + ' verified entry is pending-owner or "<YYYY-MM-DD> <terminal>"')
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

test('verified format: pending-owner and "<date> <terminal>" pass; yes, empty, pending and a bare date are refused (negative controls)', () => {
  assert.equal(ui.verifiedOk('pending-owner'), true)
  assert.equal(ui.verifiedOk('2026-10-13 tmux-ssh'), true)
  for (const bad of ['yes', '', 'pending', '2026-10-13', ' 2026-10-13 x', undefined, 3]) assert.equal(ui.verifiedOk(bad), false, JSON.stringify(bad))
  const ok = clone()
  ok.verified['⊘'] = '2026-10-13 tmux-ssh'
  assert.deepEqual(ui.glyphTableViolations(ok), [])
  for (const bad of ['yes', '', 'pending']) {
    const g = clone()
    g.verified['⊘'] = bad
    assert.ok(ui.glyphTableViolations(g).some(x => x.includes('⊘')), 'refused: ' + JSON.stringify(bad))
  }
})

test('glyph-check.js lists exactly the NEW_GLYPHS, in order', () => {
  const src = require('node:fs').readFileSync(path.join(__dirname, 'glyph-check.js'), 'utf8')
  const m = src.match(/^const GLYPHS = (\[.*\])$/m)
  assert.ok(m, 'glyph-check.js has a GLYPHS array literal')
  assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), [...ui.NEW_GLYPHS])
  assert.notDeepEqual(['⊘', '△'], [...ui.NEW_GLYPHS]) // control: a shortened list would not compare equal
})

test('FRESH_MS pins the five freshness thresholds (section 2.5)', () => {
  assert.deepEqual({ ...ui.FRESH_MS }, { quiet: 1_800_000, planReview: 86_400_000, terminalPlan: 604_800_000, codeReview: 86_400_000, dispatch: 86_400_000 })
})
