// mods/live/shell.test.js — the O4 band shell, pure half (shell.ts): tier boundaries, geometry, the forge-stats panel reader and the plan of the right-hand columns.
// Imports the REAL shell.ts (erasable syntax only, so Node strips the types). Run: node --test mods/live/shell.test.js   (also run by run-tests.sh)
// Negative controls: each "control:" case plants a broken input or table and expects the checker to say so; a mutation of shell.ts (a threshold moved, the money lock removed) turns this file red.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let S
let ui
test.before(async () => {
  S = await import(path.join(__dirname, 'shell.ts'))
  ui = await import(path.join(__dirname, 'ui.ts'))
})

const t = (id, vars) => id + (vars === undefined ? '' : JSON.stringify(vars))
const segText = segs => segs.map(s => s.text).join('')
const width = segs => ui.displayWidth(segText(segs))
const line = (...parts) => parts.map(p => (typeof p === 'string' ? { text: p } : p))
const tiersOf = (keys, mk = k => [line('row ' + k)]) => ({ tiers: Object.fromEntries(keys.map(k => [k, mk(k)])) })
const PANEL = (over = {}) => ({
  schema: 'codeforge.panel/1', updated_at_ms: 1_000_000, usage: { tiers: {} }, pet: { title: 'p', sprite: null, tiers: {} },
  side: {
    usage: tiersOf([30, 40, 50], k => [line('5h ' + k), line('7d ' + k)]),
    usage_full: tiersOf([40], () => [line('5h'), line('7d'), line(''), line('model-a 50%'), line('model-b 30%')]),
    memory: tiersOf([30, 40, 50], k => [line('記憶 12'), line('大腦 已連線')]),
  },
  ...over,
})
const ROOM = Array.from({ length: 9 }, (_, i) => ({ seq: i + 1, from: i % 3 === 0 ? 'owner' : 'seat' + i, kind: 'say', text: 'message ' + (i + 1) + '\nsecond line' }))
const FLEET = [{ lane: 'lane-a', needYou: 0, failed: 0, stuck: 0, running: 2, waiting: 0 }, { lane: 'lane-b', needYou: 1, failed: 0, stuck: 0, running: 0, waiting: 0 }, { lane: 'lane-c', needYou: 0, failed: 0, stuck: 0, running: 0, waiting: 0 }]
const input = (columns, over = {}) => ({ columns, t, menuTitle: 'menu', mainTitle: 'main', room: { rows: ROOM, fresh: 0 }, panel: S.parsePanel(PANEL(), 1_010_000), fleet: FLEET, ...over })
const planWidth = p => p.geo.left + p.geo.main + p.columns.reduce((a, c) => a + c.inner, 0) + p.columns.length + 3

test('tier: the five levels sit on bodyColumns 235 / 195 / 155 / 115, one cell either side of each boundary', () => {
  const cases = [[300, 240], [235, 240], [234, 200], [195, 200], [194, 160], [155, 160], [154, 120], [115, 120], [114, 80], [80, 80], [0, 80], [NaN, 80], [-5, 80]]
  for (const [cols, tier] of cases) assert.equal(S.bandTier(cols), tier, 'bodyColumns ' + cols)
})

test('tier: the thresholds are written on bodyColumns, not derived from a terminal width (no +5 anywhere)', () => {
  assert.deepEqual(S.TIER_AT.map(x => x[0]), [235, 195, 155, 115])
  assert.equal(S.bandTier(240 - 5), 240) // a terminal of 240 whose band is handed 235
  assert.equal(S.bandTier(240), 240)
})

test('geometry: the left column is 26 at every tier, the main window never passes 76, and the whole frame fits the width it was handed', () => {
  for (let cols = 40; cols <= 320; cols++) {
    const g = S.shellGeometry(cols)
    if (g === null) { assert.ok(cols < 26 + 3 + S.MAIN_MIN + 0, 'null only when the main window cannot reach ' + S.MAIN_MIN + ' (cols ' + cols + ')'); continue }
    assert.equal(g.left, 26)
    assert.ok(g.main >= S.MAIN_MIN && g.main <= 76, 'main ' + g.main + ' at ' + cols)
    const total = g.left + g.main + g.right.reduce((a, c) => a + c.inner, 0) + g.right.length + 3
    assert.ok(total <= cols, 'frame ' + total + ' wider than ' + cols)
    if (cols < 235 + 40) assert.ok(total >= Math.min(cols, 26 + 76 + 100) - 2 || g.main === 76, 'extra width goes to the main window first (cols ' + cols + ')')
  }
})

test('geometry: the right column set follows the tier: none, one (32), one (50), two (44 + 45), three (42 + 42 + 44)', () => {
  const inners = cols => S.shellGeometry(cols).right.map(c => c.inner)
  assert.deepEqual(inners(100), [])
  assert.deepEqual(inners(120), [32])
  assert.deepEqual(inners(160), [50])
  assert.deepEqual(inners(200), [44, 45])
  assert.deepEqual(inners(240), [42, 42, 44])
})

test('geometry: the main window starts at the same column at every tier (left 26 plus two vertical lines)', () => {
  for (const cols of [100, 120, 160, 200, 240]) assert.equal(S.shellGeometry(cols).left, 26)
})

test('geometry: a band too narrow for a main window of 30 gets no shell, so the caller keeps the tab row', () => {
  assert.equal(S.shellGeometry(58), null)
  assert.notEqual(S.shellGeometry(59), null)
  assert.equal(S.shellGeometry(NaN), null)
})

test('reader: nothing written, a non-object, another schema and an old panel without `side` are each a quiet "no summary" and never throw', () => {
  assert.deepEqual(S.parsePanel(null, 0), { status: 'absent', ageMs: null, side: null })
  assert.deepEqual(S.parsePanel(undefined, 0), { status: 'absent', ageMs: null, side: null })
  for (const bad of ['text', 7, true, [], [PANEL()]]) assert.equal(S.parsePanel(bad, 0).status, 'bad', JSON.stringify(bad))
  assert.equal(S.parsePanel({ schema: 'codeforge.panel/2', side: PANEL().side }, 0).status, 'old')
  assert.equal(S.parsePanel({ side: PANEL().side }, 0).status, 'old')
  assert.equal(S.parsePanel({ schema: 'codeforge.panel/2', side: PANEL().side }, 0).side, null)
  const old = PANEL(); delete old.side
  assert.deepEqual(S.parsePanel(old, 1_005_000), { status: 'ok', ageMs: 5_000, side: null })
})

test('reader: the side parts are read one by one; a broken part is dropped, the others stay; unknown fields are ignored', () => {
  const p = PANEL(); p.side.usage = { tiers: 'nope' }; p.side.extra = { x: 1 }; p.unknown_top = 1
  const r = S.parsePanel(p, 1_000_000)
  assert.equal(r.status, 'ok')
  assert.equal(r.side.usage, null)
  assert.ok(r.side.usageFull !== null && r.side.memory !== null)
  const q = PANEL(); q.side.memory = { tiers: { 30: [[{ text: 5 }]], 40: [line('ok')] } } // tier 30 breaks the line shape and is dropped, tier 40 stays
  assert.deepEqual(Object.keys(S.parsePanel(q, 0).side.memory), ['40'])
  const none = PANEL(); none.side = { usage: 1, usage_full: null, memory: [] }
  assert.equal(S.parsePanel(none, 0).side, null)
})

test('reader: money is never drawn: any `$` in `side` drops the whole side (control: the same table without it is read)', () => {
  const clean = PANEL()
  assert.notEqual(S.parsePanel(clean, 0).side, null)
  const dirty = PANEL(); dirty.side.usage_full.tiers[40][3] = line('model-a $12.50')
  assert.equal(S.parsePanel(dirty, 0).side, null)
  const dirtyTone = PANEL(); dirtyTone.side.memory.tiers[30][0] = [{ text: '記憶 ', tone: 'dim' }, { text: '$3' }]
  assert.equal(S.parsePanel(dirtyTone, 0).side, null)
})

test('reader: unknown tone words are dropped to plain text; the age counts from updated_at_ms and is never negative', () => {
  const p = PANEL(); p.side.usage.tiers[30][0] = [{ text: 'x', tone: 'neon' }]
  assert.deepEqual(S.parsePanel(p, 0).side.usage['30'][0], [{ text: 'x' }])
  assert.equal(S.parsePanel(PANEL(), 999_000).ageMs, 0)
  assert.equal(S.parsePanel(PANEL(), 1_090_000).ageMs, 90_000)
  assert.equal(S.parsePanel(PANEL({ updated_at_ms: 'x' }), 5).ageMs, null)
})

test('pickTier: the largest key not wider than the inner width; none fits means none', () => {
  const tiers = { 30: [line('a')], 40: [line('b')], 50: [line('c')] }
  const pick = inner => { const r = S.pickTier(tiers, inner); return r === null ? null : segText(r[0]) }
  assert.equal(pick(32), 'a'); assert.equal(pick(50), 'c'); assert.equal(pick(44), 'b'); assert.equal(pick(45), 'b'); assert.equal(pick(42), 'b')
  assert.equal(pick(29), null)
  assert.equal(S.pickTier(null, 40), null)
})

test('lines: a panel line is cut to inner - 1 with an ellipsis, by display cells (CJK counts two); tones map to PALETTE roles only', () => {
  const long = [{ text: '用量 ', tone: 'success' }, { text: 'x'.repeat(80) }]
  const segs = S.panelSegs(long, 30)
  assert.ok(width(segs) <= 29, 'width ' + width(segs))
  assert.ok(segText(segs).endsWith('…'))
  assert.equal(segs[0].color, ui.PALETTE.done)
  assert.equal(S.panelSegs([{ text: 'a', tone: 'subtle' }], 30)[0].color, ui.PALETTE.structure)
  assert.equal(S.panelSegs([{ text: 'a', tone: 'inactive' }], 30)[0].color, ui.PALETTE.idle)
  assert.equal(S.panelSegs([{ text: 'a', tone: 'dim' }], 30)[0].dim, true)
  for (const tone of ['bold', 'mono']) assert.equal(S.panelSegs([{ text: 'a', tone }], 30)[0].bold, undefined, tone + ' stays plain: bold is a whitelist')
  assert.ok(width(S.panelSegs([{ text: '大腦已連線'.repeat(10) }], 21)) <= 20)
})

test('room: complete lines only; fresh counts others\' rows after the baseline; owner rows are `here`, system rows `attention`', () => {
  const text = [{ seq: 1, from: 'owner', kind: 'say', text: 'hi', ts: 'x' }, { seq: 2, from: 'a', kind: 'say', text: 'yo' }, { seq: 3, from: 'sys', kind: 'system', text: 'note' }].map(r => JSON.stringify(r)).join('\n')
  assert.deepEqual(S.parseRoom(text).map(r => r.seq), [1, 2]) // the last line has no newline: partial, ignored
  const rows = S.parseRoom(text + '\nnot json\n{"seq":"x"}\n')
  assert.deepEqual(rows.map(r => r.seq), [1, 2, 3])
  assert.equal(S.freshCount(rows, 1), 2)
  assert.equal(S.freshCount(rows, 3), 0)
  assert.equal(S.freshCount(rows, null), 0)
  assert.equal(S.newestSeq(rows), 3)
  assert.equal(S.newestSeq([]), null)
  const lines = S.roomLines(rows, 30, 5)
  assert.equal(lines[0][0].color, ui.PALETTE.here)
  assert.equal(lines[2][0].color, ui.PALETTE.attention)
  assert.equal(lines[1][0].color, undefined)
  assert.equal(S.roomLines(rows, 30, 2).length, 2)
})

test('plan: every frame row, every body row and the vertical lines add up to the same width at every tier', () => {
  for (const cols of [100, 115, 120, 154, 155, 160, 194, 195, 200, 234, 235, 240, 300]) {
    const p = S.shellPlan(input(cols))
    assert.ok(p, 'plan at ' + cols)
    const total = planWidth(p)
    assert.ok(total <= cols, cols + ': ' + total)
    assert.equal(width(p.top), total, 'top at ' + cols)
    assert.equal(width(p.bottom), total, 'bottom at ' + cols)
    assert.equal(p.verts.length, p.columns.length + 3)
    for (const c of p.columns) {
      assert.equal(c.rows.length, S.BODY_ROWS)
      for (const r of c.rows) assert.equal(width(r), c.inner, cols + ' ' + c.id)
    }
  }
})

test('plan: with a full panel the columns of each tier are the ones the contract names', () => {
  const ids = cols => S.shellPlan(input(cols)).columns.map(c => c.id)
  assert.deepEqual(ids(100), [])
  assert.deepEqual(ids(120), ['roomUsage'])
  assert.deepEqual(ids(160), ['roomUsage'])
  assert.deepEqual(ids(200), ['room', 'usage'])
  assert.deepEqual(ids(240), ['room', 'usage', 'fleet'])
})

test('plan: each tier takes the panel table made for its width (30 at 120, 50 at 160, usage_full 40 at 200 and 240, memory 40 at 240)', () => {
  const rows = (cols, id) => S.shellPlan(input(cols)).columns.find(c => c.id === id).rows.map(r => segText(r).trimEnd())
  assert.ok(rows(120, 'roomUsage').includes('5h 30'))
  assert.ok(rows(160, 'roomUsage').includes('5h 50'))
  assert.ok(rows(200, 'usage').includes('model-a 50%'))
  assert.ok(rows(240, 'usage').includes('model-a 50%'))
  assert.ok(rows(240, 'fleet').includes('大腦 已連線'))
  assert.ok(rows(200, 'room').every(r => !r.includes('大腦')))
})

test('plan: a missing or old `side` draws the roundtable alone, at every tier, with no empty column left behind', () => {
  const none = PANEL(); delete none.side
  for (const panel of [S.parsePanel(none, 1_000_000), S.parsePanel(null, 0), S.parsePanel({ schema: 'x' }, 0), S.parsePanel('junk', 0)]) {
    for (const cols of [120, 160, 200, 240]) {
      const p = S.shellPlan(input(cols, { panel, fleet: [] }))
      assert.deepEqual(p.columns.map(c => c.id), cols <= 160 ? ['roomUsage'] : ['room'], 'tier of ' + cols)
      const total = planWidth(p)
      assert.equal(width(p.top), total)
      const joined = p.columns.map(c => c.rows.map(segText).join('|')).join('|')
      assert.ok(!joined.includes('5h'), 'no usage rows')
    }
  }
  // the fleet column alone is still drawn at 240 when autopilot has lanes but codeforge wrote nothing
  assert.deepEqual(S.shellPlan(input(240, { panel: S.parsePanel(null, 0) })).columns.map(c => c.id), ['room', 'fleet'])
})

test('plan: data older than 60 s puts "N minutes ago" on the first row of the first right column, no extra row; fresh data does not', () => {
  const stale = S.shellPlan(input(160, { panel: S.parsePanel(PANEL(), 1_000_000 + 150_000) }))
  assert.equal(segText(stale.columns[0].rows[0]).trimEnd(), 'shell.stale{"n":3}')
  assert.equal(stale.columns[0].rows.length, S.BODY_ROWS)
  const fresh = S.shellPlan(input(160, { panel: S.parsePanel(PANEL(), 1_000_000 + 59_000) }))
  assert.ok(!segText(fresh.columns[0].rows[0]).includes('shell.stale'))
  const edge = S.shellPlan(input(160, { panel: S.parsePanel(PANEL(), 1_000_000 + 60_000) }))
  assert.ok(!segText(edge.columns[0].rows[0]).includes('shell.stale'), 'exactly 60 s is still fresh')
})

test('plan: the newest message stays at the foot of the roundtable column (a chat), the usage block under a divider', () => {
  const rows = S.shellPlan(input(160)).columns[0].rows.map(r => segText(r).trimEnd())
  const at = rows.findIndex(r => r.startsWith('─'))
  assert.ok(at > 0, 'a divider row')
  assert.ok(rows[at - 1].includes('message 9'), rows[at - 1])
  assert.equal(rows[at + 1], '5h 50')
})

test('plan: the unread mark is the registered ✦ with the count, in the roundtable title, in no colour of its own', () => {
  const p = S.shellPlan(input(240, { room: { rows: ROOM, fresh: 3 } }))
  assert.ok(segText(p.top).includes('✦ 3'))
  const mark = p.top.find(s => s.text.includes('✦'))
  assert.equal(mark.color, undefined)
  assert.ok(!segText(S.shellPlan(input(240)).top).includes('✦'))
  assert.equal(ui.GLYPHS.structure.fresh, '✦')
})

test('plan: only PALETTE roles, never a background, inverse or bold; the main window border is `here`, the other windows `idle`', () => {
  const wide = ROOM.map(r => ({ ...r, text: 'x'.repeat(200) })) // every roundtable line is cut, so the ellipsis is drawn too
  const p = S.shellPlan(input(240, { room: { rows: wide, fresh: 2 } }))
  assert.ok(segText(p.columns[0].rows[6]).includes('…'))
  const all = [p.top, p.bottom, p.verts, ...p.columns.flatMap(c => c.rows)].flat()
  const roles = new Set(Object.values(ui.PALETTE))
  for (const s of all) {
    assert.equal(s.bold, undefined)
    assert.equal(s.backgroundColor, undefined)
    assert.equal(s.inverse, undefined)
    if (s.color !== undefined) assert.ok(roles.has(s.color), 'colour ' + s.color)
  }
  assert.equal(p.verts[0].color, ui.PALETTE.idle)
  assert.equal(p.verts[1].color, ui.PALETTE.here)
  assert.equal(p.verts[2].color, ui.PALETTE.here)
  assert.equal(p.verts[3].color, ui.PALETTE.idle)
  assert.equal(p.verts[p.verts.length - 1].color, ui.PALETTE.idle)
  // top frame: the left piece idle, the main piece here
  assert.equal(p.top[0].color, ui.PALETTE.idle)
  assert.ok(p.top.some(s => s.color === ui.PALETTE.here && s.text.includes('─')))
})

test('plan: the glyphs the frame draws are registered, one cell, and carry a verified entry (control: an unregistered corner would be reported)', () => {
  const f = ui.GLYPHS.structure
  for (const k of ['frameTL', 'frameTR', 'frameBL', 'frameBR', 'frameDown', 'frameUp', 'fresh']) {
    assert.equal(ui.displayWidth(f[k]), 1, k)
    assert.ok(ui.NEW_GLYPHS.includes(f[k]), k + ' is in NEW_GLYPHS')
    assert.ok(ui.verifiedOk(ui.GLYPHS.verified[f[k]]), k + ' verified')
  }
  assert.deepEqual(ui.glyphTableViolations(ui.GLYPHS), [])
  assert.deepEqual(ui.vocabularyViolations(ui.GLYPHS), [])
  const broken = JSON.parse(JSON.stringify(ui.GLYPHS)); delete broken.verified['╭']
  assert.ok(ui.glyphTableViolations(broken).some(v => v.includes('╭')))
})

test('fleet: one row per lane that has anything, the most pressing state first; a lane with nothing is not listed', () => {
  const rows = S.fleetLines(FLEET, 44, 7).map(segText)
  assert.deepEqual(rows, ['▲ lane-b 1', '● lane-a 2'])
  assert.equal(S.fleetLines(FLEET, 44, 1).length, 1)
  assert.equal(S.fleetLines(FLEET, 44, 7)[0][0].color, ui.PALETTE.attention)
  assert.equal(S.fleetLines(FLEET, 44, 7)[1][0].color, ui.PALETTE.running)
})

test('left column: the open item is marked ◐ in `here`, the others carry no mark and no colour; every row is the column wide and cut with an ellipsis', () => {
  const rows = S.leftItems([{ id: 'now', label: 'Now' }, { id: 'decide', label: 'Decide' }, { id: 'long', label: 'x'.repeat(60) }], 'decide', 26)
  assert.deepEqual(rows.map(r => r.id), ['now', 'decide', 'long'])
  assert.equal(segText(rows[1].segs).trimEnd(), '◐ Decide')
  assert.equal(rows[1].segs[0].color, ui.PALETTE.here)
  assert.equal(segText(rows[0].segs).trimEnd(), '  Now')
  assert.equal(rows[0].segs.some(s => s.color !== undefined), false)
  for (const r of rows) assert.equal(width(r.segs), 26)
  assert.ok(segText(rows[2].segs).includes('…'))
  assert.equal(S.leftItems([{ id: 'a', label: 'A' }], null, 26).some(r => segText(r.segs).includes('◐')), false)
})

// ---- ux-v7 (codeforge feature/panel-side 6cb6061): 8 body rows, the progress row inside the main window, the card list on the left, a foot title on the left and main windows ----
test('v7: the frame has 8 body rows and the shell is 12 rows (menu, top, 8, bottom, quick)', () => {
  assert.equal(S.BODY_ROWS, 8)
  assert.equal(S.SHELL_ROWS, 12)
  assert.equal(S.SHELL_ROWS, 1 + 1 + S.BODY_ROWS + 1 + 1)
})

test('v7: the main window divider joins the frame with ├ and ┤ at the main window edges, the rule between in `structure`', () => {
  for (const cols of [100, 120, 160, 200, 240]) {
    const p = S.shellPlan(input(cols))
    assert.equal(p.divider.left.text, '├', 'left edge at ' + cols)
    assert.equal(p.divider.right.text, '┤', 'right edge at ' + cols)
    assert.equal(width([p.divider.rule]), p.geo.main)
    assert.equal(p.divider.rule.color, ui.PALETTE.structure)
    assert.equal(p.divider.left.color, ui.PALETTE.here)
  }
})

test('v7: the bottom frame carries a foot title right-aligned in the left window and in the main window; the row keeps its width', () => {
  for (const cols of [100, 160, 240]) {
    const p = S.shellPlan(input(cols, { footLeft: '3/8', footMain: 'pick 1-2' }))
    const text = segText(p.bottom)
    assert.equal(width(p.bottom), planWidth(p))
    assert.ok(text.includes(' 3/8 ─'), 'left foot at ' + cols)
    assert.ok(text.includes(' pick 1-2 ─'), 'main foot at ' + cols)
    assert.ok(text.indexOf('3/8') < text.indexOf('pick 1-2'))
    const none = S.shellPlan(input(cols))
    assert.ok(!segText(none.bottom).includes('3/8'))
    assert.equal(width(none.bottom), planWidth(none))
  }
})

const CARDS = [
  { id: 'a', name: 'merge plan', answer: 'merge', sent: false },
  { id: 'b', name: 'plugin timing', answer: 'wait', sent: true },
  { id: 'c', name: 'preview width', answer: null, sent: false },
  { id: 'd', name: 'room default', answer: null, sent: false },
]
test('v7: card list: ◐ the current card, ◆ an answered one, ○ an open one; the answer is right-aligned; every row is exactly the column wide', () => {
  const rows = S.cardRows(CARDS, 2, 26)
  assert.equal(rows.length, 4)
  for (const r of rows) assert.equal(width(r.segs), 26)
  assert.deepEqual(rows.map(r => r.key), ['card:a', 'card:b', 'card:c', 'card:d'])
  assert.ok(segText(rows[0].segs).startsWith('◆ merge plan'))
  assert.ok(segText(rows[0].segs).trimEnd().endsWith(' merge'))
  assert.ok(segText(rows[2].segs).startsWith('◐ preview width'))
  assert.ok(segText(rows[3].segs).startsWith('○ room default'))
  const glyph = i => rows[i].segs[0]
  assert.equal(glyph(2).color, ui.PALETTE.here)
  assert.equal(glyph(0).color, ui.PALETTE.action)
  assert.equal(glyph(1).color, ui.PALETTE.done) // sent
  assert.equal(glyph(3).color, ui.PALETTE.idle)
})

test('v7: card list: a long name is cut with …, the answer stays whole; more cards than rows scroll so the current one is shown', () => {
  const long = [{ id: 'x', name: 'a very long card name that cannot fit', answer: 'ok', sent: false }]
  const r = S.cardRows(long, 0, 26)[0]
  assert.equal(width(r.segs), 26)
  assert.ok(segText(r.segs).includes('…'))
  assert.ok(segText(r.segs).trimEnd().endsWith(' ok'))
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 'k' + i, name: 'card ' + i, answer: null, sent: false }))
  for (const cur of [0, 5, 11]) {
    const rows = S.cardRows(many, cur, 26)
    assert.equal(rows.length, S.BODY_ROWS)
    assert.ok(rows.some(x => x.key === 'card:k' + cur && segText(x.segs).startsWith('◐')), 'cursor ' + cur)
  }
})

test('v7: progress: one cell per card (sent done, picked action, open idle), then picked/total, then the last answered card', () => {
  const segs = S.progressSegs({ cards: CARDS, last: { name: 'merge plan', answer: 'merge' }, wide: false, width: 70, t })
  const text = segText(segs)
  assert.ok(text.startsWith('▰▰▱▱ 2/4'), text)
  assert.ok(text.includes('◆ shell.prev merge plan → merge'), text)
  const cells = segs.filter(s => s.text === '▰' || s.text === '▱')
  assert.equal(cells.length, 4)
  assert.deepEqual(cells.map(c => c.color), [ui.PALETTE.action, ui.PALETTE.done, ui.PALETTE.idle, ui.PALETTE.idle])
  assert.ok(!text.includes('shell.to_send'), 'narrow: no to-send tail')
})

test('v7: progress: after a send with nothing left to send it says what was sent, in place of the last card', () => {
  const sent = CARDS.map(c => ({ ...c, answer: c.answer ?? null, sent: c.answer !== null }))
  const text = segText(S.progressSegs({ cards: sent, last: { name: 'x', answer: 'y' }, wide: true, width: 70, t }))
  assert.ok(text.includes('✓ shell.sent_n{"n":2}'), text)
  assert.ok(!text.includes('shell.prev'))
})

test('v7: progress: wide adds the to-send count; names only when they all fit, never half a name', () => {
  const base = { cards: CARDS, last: { name: 'merge plan', answer: 'merge' }, wide: true, t }
  const roomy = segText(S.progressSegs({ ...base, width: 120 }))
  assert.ok(roomy.includes('shell.to_send{"n":1}'), roomy)
  assert.ok(roomy.includes('merge plan'), roomy)
  const names = S.progressSegs({ ...base, cards: CARDS.map(c => ({ ...c, sent: false })), width: 140 })
  assert.ok(segText(names).includes('（merge plan、plugin timing'), segText(names))
  const tight = S.progressSegs({ ...base, cards: CARDS.map(c => ({ ...c, sent: false })), width: 80 })
  assert.ok(width(tight) <= 80)
  assert.ok(!segText(tight).includes('（'), 'names dropped whole: ' + segText(tight))
  assert.ok(!segText(tight).includes('plugin tim'), 'no half name')
})

test('v7: progress: control: the colours are PALETTE roles only, no background, inverse or bold', () => {
  for (const s of S.progressSegs({ cards: CARDS, last: { name: 'n', answer: 'a' }, wide: true, width: 120, t })) {
    assert.ok(s.color === undefined || Object.values(ui.PALETTE).includes(s.color), s.text)
    assert.ok(s.bg === undefined && s.inverse === undefined && s.bold === undefined, s.text)
  }
})
