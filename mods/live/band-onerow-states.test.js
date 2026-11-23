'use strict'
// Edge-state evidence suite for single-row band layout (Codex R3 Major4, Fleet-Task 01M837HGTX).
// Renders each boundary scenario as one plain-text row, asserts widths, alert retention, and `?` preservation,
// and prints every rendered row to stdout for direct inclusion in UX review packets.
// Run: node --test mods/live/band-onerow-states.test.js (wired into mods/live/run-tests.sh).
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let B, W, G, P, tZh

test.before(async () => {
  B = await import(path.join(__dirname, 'band-onerow.ts'))
  W = await import(path.join(__dirname, '..', 'tux', 'width.ts'))
  G = (await import(path.join(__dirname, '..', 'tux', 'glyphs.ts'))).GLYPHS
  P = (await import(path.join(__dirname, '..', 'tux', 'palette.ts'))).PALETTE
  const { makeT } = await import(path.join(__dirname, 'i18n.ts'))
  tZh = makeT('zh-TW')
})

const segText = seg => seg.segs.map(s => s.text).join('')

const baseInput = (over = {}) => ({
  reminder: { text: '要你決定：要不要把 shared-tui plan 合進 develop？', cardId: 'd-001', state: 'normal', hasRec: true, ...(over.reminder || {}) },
  line: { stalled: 4, running: 3, failed: 2, waiting: 0, state: 'normal', ...(over.line || {}) },
  source: { label: '開發', flags: 1, state: 'normal', ...(over.source || {}) },
  pend: { count: 21, hasRec: true, state: 'normal', ...(over.pend || {}) },
  qc: { status: 'alert', state: 'normal', ...(over.qc || {}) },
  tps: { value: 179, state: 'normal', ...(over.tps || {}) },
  spark: { bars: '▇█▆▅▆', state: 'normal', ...(over.spark || {}) },
  pet: { text: 'Ferris Lv.1', state: 'normal', ...(over.pet || {}) },
  expanded: over.expanded ?? false,
})

function emitRow(label, cols, lay) {
  const line = B.oneRowText(lay)
  const w = W.displayWidth(line)
  process.stdout.write(`[band-state] ${label} (w=${w}/${cols}): ${line}\n`)
  return { line, w }
}

test('state 1: 80-col (75) simultaneous line ✗/⊘ alert + QC ▲ alert retains both alerts without wrap', () => {
  const lay = B.layoutOneRowBand(baseInput({
    line: { stalled: 4, running: 3, failed: 2, waiting: 0, state: 'normal' },
    qc: { status: 'alert', state: 'normal' },
    pend: { count: 21, hasRec: true, state: 'normal' },
  }), 75, tZh)
  const { line, w } = emitRow('80c line(✗ 2 ⊘ 4) + QC(▲)', 75, lay)
  assert.ok(w <= 75, 'width <= 75, got ' + w)
  assert.equal(line.includes('\n'), false, 'single row')
  const lineSeg = lay.segments.find(s => s.id === 'line')
  const qcSeg = lay.segments.find(s => s.id === 'qc')
  const pendSeg = lay.segments.find(s => s.id === 'pend')
  assert.ok(lineSeg && lineSeg.short === true, 'line kept in short alert form')
  assert.equal(segText(lineSeg), '3 產線 ✗ 2 ⊘ 4')
  assert.ok(qcSeg && segText(qcSeg).includes(G.state.need_you), 'QC alert retained')
  assert.ok(pendSeg && segText(pendSeg).includes('21'), 'pend count retained')
  assert.ok(lay.remind.width >= 20, 'reminder keeps readable width >= 20, got ' + lay.remind.width)
})

test('state 2: all 4 counts at 99+ plus stale (~ prefix and ?) keep exact widths and never clip `?` at 195 and 75 cols', () => {
  const maxCounts = {
    line: { stalled: 120, running: 250, failed: 999, waiting: 100, state: 'normal' },
    source: { label: '開發', flags: 300, state: 'normal' },
    pend: { count: 210, hasRec: true, state: 'normal' },
    qc: { status: 'alert', state: 'normal' },
    tps: { value: 1250, state: 'normal' },
  }
  const normal195 = B.layoutOneRowBand(baseInput(maxCounts), 195, tZh)
  const rNorm195 = emitRow('200c 99+ normal', 195, normal195)
  assert.equal(rNorm195.w, 195)
  assert.equal((rNorm195.line.match(/99\+/g) || []).length, 6, 'line(4)+source(1)+pend(1) all cap at 99+')
  assert.ok(rNorm195.line.includes('1k+'), 'tps caps at 1k+')

  const staleMax = {
    reminder: { state: 'stale' },
    line: { stalled: 120, running: 250, failed: 999, waiting: 100, state: 'stale' },
    source: { label: '開發', flags: 300, state: 'stale' },
    pend: { count: 210, hasRec: true, state: 'stale' },
    qc: { status: 'alert', state: 'stale' },
    tps: { value: 1250, state: 'stale' },
    spark: { bars: '▇█▆▅▆', state: 'stale' },
    pet: { text: 'Ferris Lv.1', state: 'stale' },
  }
  for (const cols of [195, 75]) {
    const lay = B.layoutOneRowBand(baseInput(staleMax), cols, tZh)
    const { line, w } = emitRow(`${cols === 195 ? '200c' : '80c'} 99+ stale (~ + ?)`, cols, lay)
    assert.ok(w <= cols, `${cols}: width <= ${cols}, got ${w}`)
    assert.equal(line.includes('\n'), false, `${cols}: no wrap`)
    // Reminder keeps both ~ prefix and ? suffix even when truncated at 75 cols
    const remTxt = segText(lay.remind).trimEnd()
    assert.ok(remTxt.startsWith('~'), `${cols}: reminder starts with ~: ${remTxt}`)
    assert.ok(remTxt.endsWith('?'), `${cols}: reminder keeps trailing ? (not clipped): ${remTxt}`)
    // Alert segments retained at both 195 and 75 cols
    assert.ok(lay.segments.some(s => s.id === 'line'), `${cols}: line alert retained`)
    assert.ok(lay.segments.some(s => s.id === 'qc'), `${cols}: qc alert retained`)
    // Every visible segment starts with ~, preserves ?, and uses PALETTE.idle without dim
    for (const seg of lay.segments) {
      const txt = segText(seg)
      assert.ok(txt.startsWith('~'), `${cols} ${seg.id} starts with ~: ${txt}`)
      assert.ok(txt.includes('?'), `${cols} ${seg.id} preserves ?: ${txt}`)
      for (const s of seg.segs) {
        assert.equal(s.color, P.idle, `${cols} ${seg.id} stale uses PALETTE.idle`)
        assert.notEqual(s.dim, true, `${cols} ${seg.id} stale does not stack dim`)
      }
    }
    if (cols === 75) {
      const lineTxt = segText(lay.segments.find(s => s.id === 'line'))
      assert.ok(lineTxt.includes('✗ 99?') && lineTxt.includes('⊘ 99?'), `75c stale short line keeps both ? and spaces: ${lineTxt}`)
    }
  }
})

test('state 3: missing brief / missing quota renders `—` on data slots, omits empty spark/pet shells, and S4 idle renders 無待決', () => {
  const missingInp = baseInput({
    reminder: { text: null, state: 'missing' },
    line: { stalled: null, running: null, failed: null, waiting: null, state: 'missing' },
    source: { label: null, flags: null, state: 'missing' },
    pend: { count: null, hasRec: false, state: 'missing' },
    qc: { status: 'none', state: 'missing' },
    tps: { value: null, state: 'missing' },
    spark: { bars: null, state: 'missing' },
    pet: { text: null, state: 'missing' },
  })
  for (const cols of [195, 75]) {
    const lay = B.layoutOneRowBand(missingInp, cols, tZh)
    const { line, w } = emitRow(`${cols === 195 ? '200c' : '80c'} missing brief/quota (—)`, cols, lay)
    assert.ok(w <= cols, `${cols}: width <= ${cols}, got ${w}`)
    assert.equal(line.includes('\n'), false)
    assert.equal(lay.segments.some(s => s.id === 'spark' || s.id === 'pet'), false, `${cols}: no empty spark/pet shells`)
    for (const seg of lay.segments) {
      assert.ok(segText(seg).includes(G.structure.empty), `${cols} ${seg.id} displays —`)
      for (const s of seg.segs) {
        assert.equal(s.color, P.idle, `${cols} ${seg.id} missing uses PALETTE.idle`)
        assert.notEqual(s.dim, true, `${cols} ${seg.id} missing does not stack dim`)
      }
    }
  }
  const idleLay = B.layoutOneRowBand(baseInput({
    reminder: { text: null, state: 'normal', hasRec: false },
    pend: { count: 0, hasRec: false, state: 'normal' },
    qc: { status: 'ok', state: 'normal' },
    line: { stalled: 0, running: 2, failed: 0, waiting: 0, state: 'normal' },
    spark: { bars: null, state: 'missing' },
    pet: { text: null, state: 'missing' },
  }), 155, tZh)
  const rIdle = emitRow('160c S4 idle (0 pending)', 155, idleLay)
  assert.ok(rIdle.w <= 155)
  assert.ok(segText(idleLay.remind).includes('無待決'), 'S4 idle shows 無待決')
  assert.equal(idleLay.remind.clickable, false)
})

test('state 4: stale 6 min and 12 min both resolve to stale (> 5m threshold) and preserve ~ and ? at 195 and 75 cols', () => {
  assert.equal(B.dataStateOf(4 * 60_000, false), 'normal', '4m is fresh')
  assert.equal(B.dataStateOf(5 * 60_000, false), 'normal', 'exact 5m boundary is still normal')
  assert.equal(B.dataStateOf(6 * 60_000, false), 'stale', '6m crosses 5m threshold -> stale')
  assert.equal(B.dataStateOf(12 * 60_000, false), 'stale', '12m -> stale')

  for (const ageMin of [6, 12]) {
    const st = B.dataStateOf(ageMin * 60_000, false)
    assert.equal(st, 'stale')
    const inp = baseInput({
      reminder: { state: st },
      line: { stalled: 4, running: 3, failed: 2, waiting: 0, state: st },
      source: { label: '開發', flags: 1, state: st },
      pend: { count: 21, hasRec: true, state: st },
      qc: { status: 'alert', state: st },
      tps: { value: 179, state: st },
      spark: { bars: '▇█▆▅▆', state: st },
      pet: { text: 'Ferris Lv.1', state: st },
    })
    for (const cols of [195, 75]) {
      const lay = B.layoutOneRowBand(inp, cols, tZh)
      const { line, w } = emitRow(`${cols === 195 ? '200c' : '80c'} stale ${ageMin}m`, cols, lay)
      assert.ok(w <= cols, `stale ${ageMin}m at ${cols} fits`)
      assert.equal(line.includes('\n'), false)
      assert.ok(segText(lay.remind).trimEnd().startsWith('~'), `stale ${ageMin}m rem starts with ~`)
      assert.ok(segText(lay.remind).trimEnd().endsWith('?'), `stale ${ageMin}m rem keeps ?`)
      for (const seg of lay.segments) {
        assert.ok(segText(seg).startsWith('~') && segText(seg).includes('?'), `stale ${ageMin}m ${seg.id} keeps ~ and ?`)
      }
    }
  }
})

test('state 5: 4 widths (200/160/120/80) title comparison + collapsed (▾展開) vs expanded (▴收合)', () => {
  const realLike = {
    qc: { status: 'ok', state: 'normal' },
    tps: { value: null, state: 'missing' },
    spark: { bars: null, state: 'missing' },
    pet: { text: null, state: 'missing' },
  }
  const remW = {}
  for (const cols of [195, 155, 115, 75]) {
    const lay = B.layoutOneRowBand(baseInput({ ...realLike, expanded: cols !== 75 }), cols, tZh)
    const { w } = emitRow(`width ${cols} (${cols !== 75 ? 'expanded' : 'collapsed'})`, cols, lay)
    assert.ok(w <= cols)
    remW[cols] = W.displayWidth(segText(lay.remind).trimEnd())
  }
  assert.ok(remW[115] >= remW[75], `120-col title (${remW[115]}) >= 80-col (${remW[75]})`)
  const collapsed80 = B.layoutOneRowBand(baseInput({ ...realLike, expanded: false }), 75, tZh)
  const expanded80 = B.layoutOneRowBand(baseInput({ ...realLike, expanded: true }), 75, tZh)
  assert.equal(segText(collapsed80.toggle).trim(), '\u25BE展開')
  assert.equal(segText(expanded80.toggle).trim(), '\u25B4收合')
  emitRow('80c collapsed (no pane)', 75, collapsed80)
  emitRow('80c expanded (pane open)', 75, expanded80)
})
