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

const spriteData = (frames, over = {}) => ({
  width: 4, height: 4, transparent: '.', palette: { '#': 0xffffff, x: 0xff0000 }, frames, frame_ms: 100, ...over,
})

test('readPet SpriteData: frames[0] becomes half-block rows (transparent char off, any other char lit)', () => {
  const t = makeT('en')
  const payload = validPanel({ sprite: spriteData([['#..#', '#..#', '.xx.', '.xx.']]) })
  assert.deepEqual(P.readPet(payload).pet.sprite, [[{ text: '█  █' }], [{ text: ' ██' }]])
  const body = PT.renderPet(payload, 80, t).body.map(row => row.map(s => s.text).join(''))
  assert.equal(body[1], '█  █')
  assert.equal(body[2], ' ██')
})

test('readPet SpriteData: a short row, a row count other than height, or empty/missing frames gives no sprite lines', () => {
  assert.equal(P.readPet(validPanel({ sprite: spriteData([['#..#', '#..', '.xx.', '.xx.']]) })).pet.sprite, null)
  assert.equal(P.readPet(validPanel({ sprite: spriteData([['#..#', '#..#', '.xx.']]) })).pet.sprite, null)
  assert.equal(P.readPet(validPanel({ sprite: spriteData([]) })).pet.sprite, null)
  assert.equal(P.readPet(validPanel({ sprite: { width: 4, height: 4, transparent: '.', palette: {} } })).pet.sprite, null)
})

test('readPet SpriteData: height 6 gives exactly ceil(6/2)=3 rows, a fully transparent row pair stays as a blank row', () => {
  const sprite = spriteData([['#..#', '#..#', '....', '....', '.xx.', '.xx.']], { width: 4, height: 6 })
  assert.deepEqual(P.readPet(validPanel({ sprite })).pet.sprite, [[{ text: '█  █' }], [{ text: '' }], [{ text: ' ██' }]])
})

test('G15 pettab: petMissingReason classifies absent, bad_shape, bad_schema, no_pet, and bad_icon', () => {
  assert.equal(PT.petMissingReason(null), 'absent')
  assert.equal(PT.petMissingReason(undefined), 'absent')
  assert.equal(PT.petMissingReason('junk'), 'bad_shape')
  assert.equal(PT.petMissingReason(42), 'bad_shape')
  assert.equal(PT.petMissingReason([]), 'bad_shape')
  assert.equal(PT.petMissingReason({ schema: 'codeforge.panel/2', pet: validPanel().pet }), 'bad_schema')
  assert.equal(PT.petMissingReason({ schema: 'codeforge.panel/1' }), 'no_pet')
  assert.equal(PT.petMissingReason(validPanel({ icon: undefined })), 'bad_icon')
})

test('G15 pettab: renderPet with detail=true explains missing source and reason in zh-TW and en', () => {
  const tZh = makeT('zh-TW')
  const tEn = makeT('en')
  const cases = [
    [null, 'forge-stats.panel', 'codeforge/pet.json', 'forge-stats.panel', 'codeforge/pet.json'],
    ['junk', 'forge-stats.panel', '非 JSON 物件', 'forge-stats.panel', 'not a JSON object'],
    [{ schema: 'codeforge.panel/2', pet: validPanel().pet }, 'forge-stats.panel', 'codeforge.panel/1', 'forge-stats.panel', 'codeforge.panel/1'],
    [{ schema: 'codeforge.panel/1', pet: null }, 'forge-stats.panel', 'pet 欄位', 'forge-stats.panel', 'no pet field'],
    [validPanel({ icon: undefined }), 'forge-stats.panel', '圖示', 'forge-stats.panel', 'icon'],
  ]
  for (const [raw, zhSrc, zhWhy, enSrc, enWhy] of cases) {
    const zhRows = PT.renderPet(raw, 80, tZh, { detail: true }).body.map(r => r.map(s => s.text).join(''))
    assert.equal(zhRows[0], '沒有寵物資料')
    assert.equal(zhRows.length, 2)
    assert.ok(zhRows[1].includes(zhSrc) && zhRows[1].includes(zhWhy), 'zh-TW: ' + zhRows[1])
    const enRows = PT.renderPet(raw, 80, tEn, { detail: true }).body.map(r => r.map(s => s.text).join(''))
    assert.equal(enRows[0], 'No pet data')
    assert.equal(enRows.length, 2)
    assert.ok(enRows[1].includes(enSrc) && enRows[1].includes(enWhy), 'en: ' + enRows[1])
  }
})

test('G15 pettab: renderPet with detail=true shows source, age, and >1 min stale warning on valid pet; petPage enables detail in v7.4', () => {
  const tZh = makeT('zh-TW')
  const tEn = makeT('en')
  const nowMs = 1_000_000 + 30_000
  const fresh = PT.renderPet(validPanel({}, { updated_at_ms: 1_000_000 }), 80, tZh, { detail: true, nowMs })
  const freshLines = fresh.body.map(r => r.map(s => s.text).join(''))
  assert.ok(freshLines[freshLines.length - 1].includes('forge-stats.panel') && freshLines[freshLines.length - 1].includes('30 秒前'), freshLines.join('\n'))

  const staleNow = 1_000_000 + 3 * 60_000
  const stale = PT.renderPet(validPanel({}, { updated_at_ms: 1_000_000 }), 80, tZh, { detail: true, nowMs: staleNow })
  const staleLast = stale.body[stale.body.length - 1]
  const staleText = staleLast.map(s => s.text).join('')
  assert.ok(staleText.includes('forge-stats.panel') && staleText.includes('3 分前') && staleText.includes('>1 分'), staleText)
  assert.equal(staleLast[0].color, ui.PALETTE.broken)

  const staleEn = PT.renderPet(validPanel({}, { updated_at_ms: 1_000_000 }), 80, tEn, { detail: true, nowMs: staleNow })
  assert.ok(staleEn.body[staleEn.body.length - 1].map(s => s.text).join('').includes('>1 min'))

  const noAge = PT.renderPet(validPanel({}, { updated_at_ms: undefined }), 80, tZh, { detail: true, nowMs })
  assert.ok(noAge.body[noAge.body.length - 1].map(s => s.text).join('').includes('更新時間未知'))

  const v74Missing = PT.petPage.render({ live: null, console: null, size: { cols: 80, rows: 24 }, t: tZh, nowMs, pet: null, v74: { pm: null, pmFetchedMs: null, decide: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } })
  const v74Lines = v74Missing.body.map(r => r.map(s => s.text).join(''))
  assert.equal(v74Lines[0], '沒有寵物資料')
  assert.ok(v74Lines[1].includes('forge-stats.panel') && v74Lines[1].includes('codeforge/pet.json'), v74Lines.join('\n'))
})
