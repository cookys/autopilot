// mods/live/pettab.test.js — P2 pet tab & panel.ts readPet() contract tests:
// Runs under `node --test mods/live/pettab.test.js` (via run-tests.sh).
// Covers: icon tuple validation against GLYPHS.pet.icons, section 6 negative controls,
// usage/side poison isolation, 79 vs 80 column fallback vs payload text, displayWidth === 2,
// half-block sprite rendering without Image, and no-pet graceful fallback.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let P
let PT
let ui
let makeT
test.before(async () => {
  P = await import(path.join(__dirname, 'panel.ts'))
  PT = await import(path.join(__dirname, 'pettab.ts'))
  ui = await import(path.join(__dirname, 'ui.ts'))
  const i18n = await import(path.join(__dirname, 'i18n.ts'))
  makeT = i18n.makeT
})

const validPanel = (overPet = {}, overTop = {}) => ({
  schema: 'codeforge.panel/1',
  updated_at_ms: 1_000_000,
  pet: {
    title: 'Neko Lv.2',
    icon: { id: 'cat', emoji: '🐱', fallback: ':3', text: '🐱' },
    sprite: [String.fromCodePoint(0x2584, 0x2588, 0x2584), String.fromCodePoint(0x2588, 0x2580, 0x2588)],
    tiers: {
      60: [[{ text: 'focus 10' }]],
      80: [[{ text: 'focus 10  energy 99%', tone: 'success' }]],
    },
    ...overPet,
  },
  ...overTop,
})

test('readPet: validates all three whitelist entries (cat, chick, crab) with emoji or fallback text', () => {
  for (const [id, emoji, fallback] of [['cat', '🐱', ':3'], ['chick', '🐣', 'o<'], ['crab', '🦀', '}{']]) {
    for (const text of [emoji, fallback]) {
      const r = P.readPet(validPanel({ icon: { id, emoji, fallback, text } }))
      assert.ok(r.pet !== null, id + ' text=' + text)
      assert.deepEqual(r.pet.icon, { id, emoji, fallback, text })
    }
  }
})

test('readPet negative controls (section 6): ⚠️ not in list, CJK two chars, valid text + invalid fallback at 79 cols, mismatched fields -> no pet', () => {
  const cases = [
    ['⚠️ emoji', { id: 'cat', emoji: '⚠️', fallback: ':3', text: '⚠️' }],
    ['⚠️ text', { id: 'cat', emoji: '🐱', fallback: ':3', text: '⚠️' }],
    ['CJK two chars in text', { id: 'cat', emoji: '🐱', fallback: ':3', text: '寵物' }],
    ['CJK two chars in fallback', { id: 'cat', emoji: '🐱', fallback: '寵物', text: '🐱' }],
    ['valid text + invalid fallback', { id: 'cat', emoji: '🐱', fallback: 'xx', text: '🐱' }],
    ['mismatched emoji across entries', { id: 'cat', emoji: '🐣', fallback: ':3', text: '🐱' }],
    ['mismatched fallback across entries', { id: 'chick', emoji: '🐣', fallback: ':3', text: '🐣' }],
    ['unknown id', { id: 'dog', emoji: '🐶', fallback: ':3', text: '🐶' }],
    ['missing icon', null],
  ]
  const t = makeT('zh-TW')
  for (const [label, icon] of cases) {
    const payload = icon === null ? validPanel({ icon: undefined }) : validPanel({ icon })
    assert.deepEqual(P.readPet(payload), { pet: null }, label)
    const rendered79 = PT.renderPet(payload, 79, t)
    assert.deepEqual(rendered79.body.map(r => r.map(s => s.text).join('')), ['沒有寵物資料'], label + ' @79')
    const rendered80 = PT.renderPet(payload, 80, t)
    assert.deepEqual(rendered80.body.map(r => r.map(s => s.text).join('')), ['沒有寵物資料'], label + ' @80')
  }
  for (const bad of [null, undefined, 'junk', 42, [], { schema: 'codeforge.panel/2', pet: validPanel().pet }]) {
    assert.deepEqual(P.readPet(bad), { pet: null })
    assert.deepEqual(PT.renderPet(bad, 80, t).body.map(r => r.map(s => s.text).join('')), ['沒有寵物資料'])
  }
})

test('readPet isolation: usage and side poison fields leave readPet() output unchanged', () => {
  const clean = P.readPet(validPanel())
  const poisoned = P.readPet(validPanel({}, {
    usage: { tiers: { 40: [[{ text: '$12.34' }], [{ text: '5h 80%' }]] } },
    side: { usage: { tiers: { 30: [[{ text: '$99' }]] } }, memory: { tiers: { 30: [[{ text: 'hack' }]] } } },
  }))
  assert.deepEqual(poisoned, clean)
  assert.deepEqual(Object.keys(clean), ['pet'])
})

test('pettab 79 vs 80 columns: < 80 uses whitelist entry fallback (ignoring payload text), >= 80 uses payload text, both draw displayWidth === 2', () => {
  const t = makeT('zh-TW')
  for (const [id, emoji, fallback] of [['cat', '🐱', ':3'], ['chick', '🐣', 'o<'], ['crab', '🦀', '}{']]) {
    const payload = validPanel({ title: 'P', icon: { id, emoji, fallback, text: emoji } })
    const icon79 = PT.petIconLabel(P.readPet(payload).pet.icon, 79)
    const icon80 = PT.petIconLabel(P.readPet(payload).pet.icon, 80)
    assert.equal(icon79, fallback, id + ' at 79 draws whitelist fallback, not payload text')
    assert.equal(icon80, emoji, id + ' at 80 draws payload text')
    assert.equal(ui.displayWidth(icon79), 2, id + ' @79 displayWidth === 2')
    assert.equal(ui.displayWidth(icon80), 2, id + ' @80 displayWidth === 2')

    const b79 = PT.renderPet(payload, 79, t).body.map(r => r.map(s => s.text).join(''))
    const b80 = PT.renderPet(payload, 80, t).body.map(r => r.map(s => s.text).join(''))
    assert.equal(b79[0], fallback + ' P')
    assert.equal(b80[0], emoji + ' P')
    assert.ok(b79.includes('focus 10'))
    assert.ok(b80.includes('focus 10  energy 99%'))
  }
})

test('pettab half-block sprite: converts pixel matrix to half-block raster lines and sanitizes controls', () => {
  const t = makeT('en')
  const payload = validPanel({
    sprite: { pixels: [[1, 0, 1], [0, 1, 1]] },
    tiers: { 40: [[{ text: 'atk \u001b[31m5', tone: 'subtle' }]] },
  })
  const r = PT.renderPet(payload, 80, t)
  const lines = r.body.map(row => row.map(s => s.text).join(''))
  assert.equal(lines[1], String.fromCodePoint(0x2580, 0x2584, 0x2588))
  assert.equal(lines[2], 'atk [31m5')
  assert.equal(r.body[2][0].color, ui.PALETTE.structure)
})
