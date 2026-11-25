'use strict'
// Pure unit tests for single-row band layout (2026-11-23-band-layout v4, Fleet-Task 01M837HGTX)
// and Decide page C degradation / hysteresis rules (Fleet-Task 01M837ZECP).
// Run: node --test mods/live/band-onerow.test.js (wired into mods/live/run-tests.sh).
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let B, L, W, G, P, tZh, tEn

test.before(async () => {
  B = await import(path.join(__dirname, 'band-onerow.ts'))
  L = await import(path.join(__dirname, 'pages', 'layout.ts'))
  W = await import(path.join(__dirname, '..', 'tux', 'width.ts'))
  G = (await import(path.join(__dirname, '..', 'tux', 'glyphs.ts'))).GLYPHS
  P = (await import(path.join(__dirname, '..', 'tux', 'palette.ts'))).PALETTE
  const { makeT } = await import(path.join(__dirname, 'i18n.ts'))
  tZh = makeT('zh-TW')
  tEn = makeT('en')
})

const segText = seg => seg.segs.map(s => s.text).join('')

const sampleInput = (over = {}) => ({
  reminder: { text: '要你決定：合併 shared-tui plan 進 develop？', cardId: 'd-001', state: 'normal', hasRec: true, ...(over.reminder || {}) },
  line: { stalled: 4, running: 3, failed: 2, waiting: 0, state: 'normal', ...(over.line || {}) },
  source: { label: '開發', flags: 1, state: 'normal', ...(over.source || {}) },
  pend: { count: 21, hasRec: true, state: 'normal', ...(over.pend || {}) },
  qc: { status: 'alert', state: 'normal', ...(over.qc || {}) },
  tps: { value: 78, state: 'normal', ...(over.tps || {}) },
  spark: { bars: '▇█▆▅▆', state: 'normal', ...(over.spark || {}) },
  pet: { text: 'Ferris Lv.1', state: 'normal', ...(over.pet || {}) },
  expanded: over.expanded ?? false,
})

// Carbon Critical (a): 80-col (bodyColumns = 75) with failed (✗) and stalled (⊘) alerts retains alerts
test('carbon-critical-a: 80-col bodyColumns=75 with failed & stalled keeps shortened alert line and QC alert', () => {
  const lay = B.layoutOneRowBand(sampleInput(), 75, tZh)
  const text = B.oneRowText(lay)
  assert.ok(W.displayWidth(text) <= 75, 'total display width <= 75, got ' + W.displayWidth(text))
  assert.equal(text.includes('\n'), false, 'single row, no newline')
  const lineSeg = lay.segments.find(s => s.id === 'line')
  const qcSeg = lay.segments.find(s => s.id === 'qc')
  assert.ok(lineSeg, 'alerting line segment MUST NOT be dropped at 75 cols')
  assert.equal(lineSeg.short, true, 'alerting line uses shortened form at 75 cols')
  assert.ok(lineSeg.width <= 14, 'shortened line width <= 14, got ' + lineSeg.width)
  assert.ok(segText(lineSeg).includes(G.state.failed + ' 2'), 'shortened line contains spaced failed alert: ' + segText(lineSeg))
  assert.ok(segText(lineSeg).includes(G.state.stalled + ' 4'), 'shortened line contains spaced stalled alert: ' + segText(lineSeg))
  assert.ok(segText(lineSeg).indexOf(G.state.stalled) < segText(lineSeg).indexOf(G.state.failed), 'shortened line keeps wide ⊘-before-✗ order: ' + segText(lineSeg))
  assert.ok(qcSeg, 'alerting QC segment MUST NOT be dropped at 75 cols')
  assert.ok(segText(qcSeg).includes(G.state.need_you), 'QC alert mark retained')
  assert.ok(lay.remind.width >= 20, 'reminder keeps readable width >= 20, got ' + lay.remind.width)
})

// Carbon Critical (b): max values match §2.2 column width table, total <= bodyColumns, invariant separators across 1/9/10/99/100
test('carbon-critical-b: max values match §2.2 column widths, no wrap, and separators stay fixed across 1/9/10/99/100', () => {
  const maxInp = sampleInput({
    line: { stalled: 120, running: 250, failed: 999, waiting: 100 },
    source: { label: '開發', flags: 300 },
    pend: { count: 210 },
    tps: { value: 1250 },
  })
  const layMax = B.layoutOneRowBand(maxInp, 195, tZh)
  const textMax = B.oneRowText(layMax)
  assert.ok(W.displayWidth(textMax) <= 195, 'total width <= 195')
  assert.equal(textMax.includes('\n'), false, 'no line wrap')
  const byId = Object.fromEntries(layMax.segments.map(s => [s.id, s]))
  assert.equal(W.displayWidth(segText(byId.line)), 26, 'line width 26')
  assert.equal(W.displayWidth(segText(byId.source)), 16, 'source width 16')
  assert.equal(W.displayWidth(segText(byId.pend)), 10, 'pend width 10')
  assert.equal(W.displayWidth(segText(byId.qc)), 8, 'qc width 8')
  assert.equal(W.displayWidth(segText(byId.tps)), 14, 'tps width 14')
  assert.equal(W.displayWidth(segText(byId.spark)), 6, 'spark width 6')
  assert.equal(W.displayWidth(segText(byId.pet)), 12, 'pet width 12')
  assert.ok(segText(byId.pend).includes('99+'), 'pend 210 -> 99+')
  assert.ok(segText(byId.tps).includes('1k+'), 'tps 1250 -> 1k+')
  assert.equal((segText(byId.line).match(/99\+/g) || []).length, 4, 'all 4 line counts cap at 99+')

  // Incremental growth 1 -> 9 -> 10 -> 99 -> 100: separator positions NEVER move
  const baseline = B.layoutOneRowBand(sampleInput({ line: { stalled: 1, running: 1, failed: 1, waiting: 1 }, source: { flags: 1 }, pend: { count: 1 }, tps: { value: 1 } }), 195, tZh).sepPositions
  for (const n of [1, 9, 10, 99, 100, 210]) {
    const cur = B.layoutOneRowBand(sampleInput({
      line: { stalled: n, running: n, failed: n, waiting: n },
      source: { label: '開發', flags: n },
      pend: { count: n },
      tps: { value: n * 10 },
    }), 195, tZh)
    assert.deepEqual(cur.sepPositions, baseline, 'separator positions invariant at n=' + n)
    assert.equal(W.displayWidth(B.oneRowText(cur)), 195, 'exact full width at n=' + n)
  }
})

// Codex Major (1): width table, abbreviations, and 160-col decoration drop rule
test('codex-major-1: width table matches both zh-TW and en; 160-col drops decorations before truncating reminder', () => {
  for (const t of [tZh, tEn]) {
    const lay = B.layoutOneRowBand(sampleInput({ reminder: { text: 'Short' } }), 195, t)
    const widths = Object.fromEntries(lay.segments.map(s => [s.id, W.displayWidth(segText(s))]))
    assert.deepEqual(widths, { line: 26, source: 16, pend: 10, qc: 8, tps: 14, spark: 6, pet: 12 })
  }
  // 155 cols with 43-col reminder: full reminder does not fit with pet (36 < 43), so pet drops first
  const lay155 = B.layoutOneRowBand(sampleInput(), 155, tZh)
  assert.ok(lay155.dropped.includes('pet'), 'pet dropped at 155 cols when reminder would truncate')
  assert.equal(segText(lay155.remind).includes('\u2026'), false, 'reminder fits in full once pet dropped')
})

// Codex Major (2): data 3-states (normal / stale / missing) keep identical widths, no emoji, idle shows 無待決
test('codex-major-2: data 3-states keep exact fixed widths with no emoji; idle shows 無待決', () => {
  const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u26A0\u25B6]/u
  for (const st of ['normal', 'stale', 'missing']) {
    const lay = B.layoutOneRowBand(sampleInput({
      reminder: { state: st },
      line: { state: st, stalled: st === 'missing' ? null : 4, running: st === 'missing' ? null : 3, failed: st === 'missing' ? null : 2, waiting: st === 'missing' ? null : 0 },
      source: { state: st, label: st === 'missing' ? null : '開發', flags: st === 'missing' ? null : 1 },
      pend: { state: st, count: st === 'missing' ? null : 21 },
      qc: { state: st, status: st === 'missing' ? 'none' : 'alert' },
      tps: { state: st, value: st === 'missing' ? null : 83 },
      spark: { state: st, bars: st === 'missing' ? null : '▇█▆▅▆' },
      pet: { state: st, text: st === 'missing' ? null : 'Ferris Lv.1' },
    }), 195, tZh)
    const widths = Object.fromEntries(lay.segments.map(s => [s.id, W.displayWidth(segText(s))]))
    // Carbon R3 m1: empty/missing spark & pet omit unlabelled `│ —` shells; all 5 labelled data segments keep exact fixed widths.
    const expectedWidths = st === 'missing'
      ? { line: 26, source: 16, pend: 10, qc: 8, tps: 14 }
      : { line: 26, source: 16, pend: 10, qc: 8, tps: 14, spark: 6, pet: 12 }
    assert.deepEqual(widths, expectedWidths, 'widths unchanged in state ' + st)
    const full = B.oneRowText(lay)
    assert.equal(EMOJI_RE.test(full), false, 'no emoji in state ' + st)
    if (st === 'stale') {
      for (const seg of lay.segments) {
        assert.ok(segText(seg).startsWith('~'), seg.id + ' stale starts with ~')
        assert.ok(segText(seg).includes('?'), seg.id + ' stale includes ?')
        for (const s of seg.segs) {
          assert.equal(s.color, P.idle, seg.id + ' stale uses PALETTE.idle')
          assert.notEqual(s.dim, true, seg.id + ' stale does not stack dim')
        }
      }
    }
    if (st === 'missing') {
      for (const seg of lay.segments) {
        assert.ok(segText(seg).includes(G.structure.empty), seg.id + ' missing shows em-dash')
      }
    }
  }
  const idle = B.layoutOneRowBand(sampleInput({ reminder: { text: null }, pend: { count: 0 } }), 195, tZh)
  assert.ok(segText(idle.remind).includes('無待決'), 'idle shows 無待決')
  assert.equal(idle.remind.clickable, false, 'idle reminder is not clickable')
})

// Codex Major (3): routing table & bottom hint row (aligned per trace-inventory G01/G02/G15)
test('codex-major-3: routing table maps every clickable segment to its digit page; decorations/sep non-clickable; bottom hint lists page digits', () => {
  assert.equal(B.bandSlotPage('remind', false), 'decide')
  assert.equal(B.bandSlotPage('remind', true), null)
  assert.equal(B.bandSlotPage('line'), 'dispatch')
  assert.equal(B.bandSlotPage('source'), 'hygiene')
  assert.equal(B.bandSlotPage('pend'), 'decide')
  assert.equal(B.bandSlotPage('qc'), 'review')
  assert.equal(B.bandSlotPage('tps'), 'spend')
  assert.equal(B.bandSlotPage('spark'), null)
  assert.equal(B.bandSlotPage('pet'), null)
  assert.equal(B.bandSlotPage('sep'), null)
  assert.equal(B.bandSlotPage('blank'), null)

  const lay = B.layoutOneRowBand(sampleInput(), 195, tZh)
  for (const id of ['spark', 'pet']) {
    const seg = lay.segments.find(s => s.id === id)
    assert.equal(seg.clickable, false, id + ' is non-clickable')
    assert.equal(seg.page, null, id + ' has no route page')
  }
  const hintWide = B.bandBottomHint(120, false, tZh)
  for (const k of ['2', '3', '4', '5', '6', '0', 'w']) assert.ok(hintWide.includes(k), 'wide hint includes ' + k)
  const hintNarrow = B.bandBottomHint(20, false, tZh)
  for (const k of ['2', '3', '4', '5', '6', '0', 'w']) assert.ok(hintNarrow.includes(k), 'narrow hint still includes ' + k)
  assert.ok(W.displayWidth(hintNarrow) <= 20, 'narrow hint fits width')
})

// Codex Major (4): expand/collapse model + 3 regression cases
test('codex-major-4: expand/collapse arrows and 3 regression cases (refresh, narrow->widen, page switch)', () => {
  const closedLay = B.layoutOneRowBand(sampleInput({ expanded: false }), 195, tZh)
  assert.equal(segText(closedLay.toggle).trim(), '\u25BE展開')
  const openLay = B.layoutOneRowBand(sampleInput({ expanded: true }), 195, tZh)
  assert.equal(segText(openLay.toggle).trim(), '\u25B4收合')

  // Regression 1: manual collapse -> refresh -> still collapsed
  let st = B.initialBandExpand('decide')
  st = B.toggleBandExpand(st)
  assert.equal(st.expanded, true)
  assert.equal(st.activePage, 'now')
  assert.equal(st.prevPage, 'decide')
  st = B.toggleBandExpand(st)
  assert.equal(st.expanded, false)
  assert.equal(st.activePage, 'decide')
  st = B.bandExpandOnRefresh(st)
  assert.equal(st.expanded, false, 'regression 1: manual collapse survives refresh')

  // Regression 2: narrow -> widen -> restored (manual state intact, segments return)
  let st2 = B.toggleBandExpand(B.initialBandExpand('now'))
  st2 = B.bandExpandOnResize(st2, 75)
  assert.equal(st2.expanded, true, 'resize narrow does not overwrite manual expand')
  const narrow = B.layoutOneRowBand(sampleInput({ expanded: st2.expanded }), 75, tZh)
  assert.ok(narrow.dropped.length > 0, 'narrow drops segments')
  st2 = B.bandExpandOnResize(st2, 195)
  assert.equal(st2.expanded, true, 'resize widen preserves manual expand')
  const wide = B.layoutOneRowBand(sampleInput({ expanded: st2.expanded }), 195, tZh)
  assert.equal(wide.dropped.length, 0, 'regression 2: widen restores all segments')

  // Regression 3: switch page -> expanded state unchanged
  let st3 = B.toggleBandExpand(B.initialBandExpand('now'))
  st3 = B.bandExpandOnPageChange(st3, 'decide')
  assert.equal(st3.expanded, true, 'regression 3a: switch page while expanded keeps expanded')
  st3 = B.toggleBandExpand(st3)
  assert.equal(st3.expanded, false)
  st3 = B.bandExpandOnPageChange(st3, 'review')
  assert.equal(st3.expanded, false, 'regression 3b: switch page while collapsed keeps collapsed')
})

// Codex Major (5): right alignment — tok/s 9 -> 78 -> 120 keeps suffix and following segments stationary
test('codex-major-5: right alignment keeps tok/s suffix and subsequent separators stationary across 9 -> 78 -> 120', () => {
  const pos = (v) => {
    const lay = B.layoutOneRowBand(sampleInput({ tps: { value: v } }), 195, tZh)
    const text = B.oneRowText(lay)
    const idx = text.indexOf(' tok/s')
    return { suffixCol: W.displayWidth(text.slice(0, idx)), seps: lay.sepPositions }
  }
  const p9 = pos(9)
  const p78 = pos(78)
  const p120 = pos(120)
  const p1250 = pos(1250)
  assert.equal(p78.suffixCol, p9.suffixCol, 'tok/s suffix col unchanged 9 -> 78')
  assert.equal(p120.suffixCol, p9.suffixCol, 'tok/s suffix col unchanged 78 -> 120')
  assert.equal(p1250.suffixCol, p9.suffixCol, 'tok/s suffix col unchanged 120 -> 1k+')
  assert.deepEqual(p78.seps, p9.seps)
  assert.deepEqual(p120.seps, p9.seps)
  assert.deepEqual(p1250.seps, p9.seps)
})

// Decide C dual-column rules: 82/83/84 threshold, +/-2 hysteresis, equal column widths (>=40 each + 3 sep)
test('decide-c-layout: 82/83/84 threshold, +/-2 hysteresis, and column widths', () => {
  assert.equal(L.decideLayoutMode(82, null), 'single')
  assert.equal(L.decideLayoutMode(83, null), 'dual')
  assert.equal(L.decideLayoutMode(84, null), 'dual')

  // Hysteresis from dual: stays dual at 82 and 81, switches single at 80
  assert.equal(L.decideLayoutMode(82, 'dual'), 'dual')
  assert.equal(L.decideLayoutMode(81, 'dual'), 'dual')
  assert.equal(L.decideLayoutMode(80, 'dual'), 'single')

  // Hysteresis from single: stays single at 83 and 84, switches dual at 85
  assert.equal(L.decideLayoutMode(83, 'single'), 'single')
  assert.equal(L.decideLayoutMode(84, 'single'), 'single')
  assert.equal(L.decideLayoutMode(85, 'single'), 'dual')

  // Equal widths: at 83 -> 40 + 3 + 40 = 83
  const w83 = L.decideColumnWidths(83)
  assert.deepEqual(w83, { leftW: 40, rightW: 40, sepW: 3 })
  const w120 = L.decideColumnWidths(120)
  assert.ok(w120.leftW >= 68, 'left column has room at 120')
  assert.ok(L.decideColumnWidths(205).leftW >= 120, 'left column has room at 205')
  assert.equal(w120.leftW + w120.sepW + w120.rightW, 120)
})

// Codex R3 Major2 / Carbon R3 M2: 120-col reclaims non-alert segments before truncating reminder; 120-col title is never shorter than 80-col
test('r3-major2: 120-col (115) reclaims non-alert segments before truncating reminder and is never shorter than 80-col (75)', () => {
  const longRem = { text: '要你決定：要不要把 shared-tui plan 合進 develop？', cardId: 'd-001', state: 'normal', hasRec: true }
  const scenarios = [
    { name: 'qc-ok + tps-missing', over: { reminder: longRem, qc: { status: 'ok' }, tps: { value: null, state: 'missing' }, spark: { bars: null, state: 'missing' }, pet: { text: null, state: 'missing' } } },
    { name: 'qc-ok + tps-179', over: { reminder: longRem, qc: { status: 'ok' }, tps: { value: 179, state: 'normal' }, spark: { bars: null, state: 'missing' }, pet: { text: null, state: 'missing' } } },
    { name: 'qc-alert + tps-179', over: { reminder: longRem, qc: { status: 'alert' }, tps: { value: 179, state: 'normal' }, spark: { bars: '▇█▆▅▆', state: 'normal' }, pet: { text: 'Ferris Lv.1', state: 'normal' } } },
  ]
  for (const { name, over } of scenarios) {
    const lay115 = B.layoutOneRowBand(sampleInput(over), 115, tZh)
    const lay75 = B.layoutOneRowBand(sampleInput(over), 75, tZh)
    const rem115 = segText(lay115.remind).trimEnd()
    const rem75 = segText(lay75.remind).trimEnd()
    assert.ok(W.displayWidth(B.oneRowText(lay115)) <= 115, name + ': 115 fits')
    assert.ok(W.displayWidth(B.oneRowText(lay75)) <= 75, name + ': 75 fits')
    assert.ok(W.displayWidth(rem115) >= W.displayWidth(rem75), `${name}: 120-col title (${W.displayWidth(rem115)}) >= 80-col (${W.displayWidth(rem75)}): ${rem115} vs ${rem75}`)
    assert.equal(rem115.includes('\u2026'), false, `${name}: 120-col shows full 51-col title once non-alert segments reclaimed: ${rem115}`)
    assert.ok(lay115.dropped.includes('source'), `${name}: non-alert source reclaimed at 115 cols`)
  }
})

// Carbon R3 m1: sparkline and pet omit empty shells when missing and return width budget to reminder
test('r3-minor1: missing sparkline and pet omit unlabelled shells and free width to reminder', () => {
  const withDecor = B.layoutOneRowBand(sampleInput(), 195, tZh)
  const noDecor = B.layoutOneRowBand(sampleInput({
    spark: { bars: null, state: 'missing' },
    pet: { text: null, state: 'missing' },
  }), 195, tZh)
  assert.equal(noDecor.segments.some(s => s.id === 'spark' || s.id === 'pet'), false, 'spark & pet omitted when missing')
  assert.equal(B.oneRowText(noDecor).includes(G.structure.bandSep + ' ' + G.structure.empty), false, 'no unlabelled │ — empty shell')
  assert.equal(noDecor.remind.width, withDecor.remind.width + 24, 'freed 24 cols (9 spark + 15 pet) return to reminder')
  assert.equal(W.displayWidth(B.oneRowText(noDecor)), 195, 'total row still fills exact 195 cols')
})

// Codex R3 Minor + R4 Minor: 80-col shortened alert form unifies wide ⊘-before-✗ order (`3 產線 ⊘ 4 ✗ 2`) and preserves `+` + `?` within 14 cols
test('r3-minor-spacing: 80-col shortened line uses `3 產線 ⊘ 4 ✗ 2` with spaces and preserves `+` + `?` at 99+ / stale', () => {
  const normal = B.formatLineShort({ stalled: 4, running: 3, failed: 2, waiting: 0, state: 'normal' }, tZh)
  assert.equal(segText(normal), '3 產線 ⊘ 4 ✗ 2')
  assert.equal(normal.width, 14)

  const maxNormal = B.formatLineShort({ stalled: 250, running: 3, failed: 120, waiting: 0, state: 'normal' }, tZh)
  assert.ok(maxNormal.width <= 14, 'max normal short <= 14, got ' + maxNormal.width)
  assert.ok(segText(maxNormal).includes('⊘ 99+'), 'max normal keeps space: ' + segText(maxNormal))
  assert.ok(segText(maxNormal).includes('✗ 99+'), 'max normal keeps space: ' + segText(maxNormal))
  assert.ok(segText(maxNormal).indexOf('⊘') < segText(maxNormal).indexOf('✗'), 'normal short keeps ⊘ before ✗')

  const maxStale = B.formatLineShort({ stalled: 250, running: 3, failed: 120, waiting: 0, state: 'stale' }, tZh)
  assert.ok(maxStale.width <= 14, 'max stale short <= 14, got ' + maxStale.width)
  assert.ok(segText(maxStale).startsWith('~'), 'stale starts with ~: ' + segText(maxStale))
  assert.ok(segText(maxStale).includes('⊘99+?'), 'stale preserves + and ?: ' + segText(maxStale))
  assert.ok(segText(maxStale).includes('✗99+?'), 'stale preserves + and ?: ' + segText(maxStale))
  assert.ok(segText(maxStale).indexOf('⊘') < segText(maxStale).indexOf('✗'), 'stale short keeps ⊘ before ✗')
})

// Codex R4 Major 1: stale overflow counts preserve `+` (`99+?`), remain distinct from exact 99 (`99?`), and stay within §2.2 column widths
test('r4-major1: normal and stale distinguish exact 99 from 99+ across all count segments without exceeding §2.2 widths', () => {
  const exact99 = {
    line: { stalled: 99, running: 99, failed: 99, waiting: 99 },
    source: { label: '開發', flags: 99 },
    pend: { count: 99, hasRec: true },
    tps: { value: 999 },
  }
  const over99 = {
    line: { stalled: 120, running: 250, failed: 999, waiting: 100 },
    source: { label: '開發', flags: 300 },
    pend: { count: 210, hasRec: true },
    tps: { value: 1250 },
  }
  const withState = (cfg, st) => sampleInput({
    reminder: { state: st },
    line: { ...cfg.line, state: st },
    source: { ...cfg.source, state: st },
    pend: { ...cfg.pend, state: st },
    qc: { status: 'alert', state: st },
    tps: { ...cfg.tps, state: st },
    spark: { bars: '▇█▆▅▆', state: st },
    pet: { text: 'Ferris Lv.1', state: st },
  })
  const expectedWidths = { line: 26, source: 16, pend: 10, qc: 8, tps: 14, spark: 6, pet: 12 }

  for (const t of [tZh, tEn]) {
    const norm99 = B.layoutOneRowBand(withState(exact99, 'normal'), 195, t)
    const normOver = B.layoutOneRowBand(withState(over99, 'normal'), 195, t)
    assert.equal((B.oneRowText(norm99).match(/99\+/g) || []).length, 0, 'normal 99 has no 99+')
    assert.equal((B.oneRowText(normOver).match(/99\+/g) || []).length, 6, 'normal over-99 has 6x 99+')
    assert.deepEqual(normOver.sepPositions, norm99.sepPositions, 'normal 99 vs 99+ keeps separators fixed')

    const stale99 = B.layoutOneRowBand(withState(exact99, 'stale'), 195, t)
    const staleOver = B.layoutOneRowBand(withState(over99, 'stale'), 195, t)
    const s99Text = B.oneRowText(stale99)
    const sOverText = B.oneRowText(staleOver)
    assert.equal((s99Text.match(/99\+\?/g) || []).length, 0, 'stale 99 has no 99+?')
    assert.equal((s99Text.match(/(?<!\d)99\?/g) || []).length, 6, 'stale 99 has 6x 99?: ' + s99Text)
    assert.equal((sOverText.match(/99\+\?/g) || []).length, 6, 'stale over-99 has 6x 99+?: ' + sOverText)
    assert.equal((sOverText.match(/(?<!\+)99\?/g) || []).length, 0, 'stale over-99 never loses +: ' + sOverText)
    assert.notEqual(sOverText, s99Text, 'stale 99 and stale 99+ are visually distinct')
    assert.deepEqual(staleOver.sepPositions, norm99.sepPositions, 'stale 99+? keeps identical separator positions')
    for (const lay of [norm99, normOver, stale99, staleOver]) {
      const widths = Object.fromEntries(lay.segments.map(s => [s.id, W.displayWidth(segText(s))]))
      assert.deepEqual(widths, expectedWidths, 'every segment matches §2.2 width table')
      assert.equal(W.displayWidth(B.oneRowText(lay)), 195, 'exact total 195 cols')
    }
  }

  // 80-col (75) narrow stale distinguishes 99 from 99+ on both line short form and pend without exceeding limits
  const stale99_75 = B.layoutOneRowBand(withState(exact99, 'stale'), 75, tZh)
  const staleOver_75 = B.layoutOneRowBand(withState(over99, 'stale'), 75, tZh)
  assert.ok(W.displayWidth(B.oneRowText(stale99_75)) <= 75)
  assert.ok(W.displayWidth(B.oneRowText(staleOver_75)) <= 75)
  const line99 = stale99_75.segments.find(s => s.id === 'line')
  const lineOver = staleOver_75.segments.find(s => s.id === 'line')
  const pend99 = stale99_75.segments.find(s => s.id === 'pend')
  const pendOver = staleOver_75.segments.find(s => s.id === 'pend')
  assert.equal(segText(line99), '~3 ⊘ 99? ✗ 99?')
  assert.equal(segText(lineOver), '~3 ⊘99+? ✗99+?')
  assert.ok(W.displayWidth(segText(lineOver)) <= B.BAND_COL_WIDTHS.lineShortMax)
  assert.equal(segText(pend99), '~2待決 99?')
  assert.equal(segText(pendOver), '~2待決99+?')
  assert.equal(W.displayWidth(segText(pendOver)), B.BAND_COL_WIDTHS.pend)
})

// Codex R4 Major 2: missing decision source shows 待決資料缺失 (never 無待決); stale 0-pending shows ~無待決?; only normal + count=0 shows 無待決
test('r4-major2: missing and stale decision states never claim 無待決; only normal count=0 is idle', () => {
  const missingBoth = sampleInput({
    reminder: { text: null, state: 'missing', hasRec: false },
    pend: { count: null, hasRec: false, state: 'missing' },
  })
  const missZh = B.layoutOneRowBand(missingBoth, 195, tZh)
  assert.ok(segText(missZh.remind).includes('待決資料缺失'), 'missing zh-TW shows 待決資料缺失: ' + segText(missZh.remind))
  assert.equal(segText(missZh.remind).includes('無待決'), false, 'missing zh-TW must NOT claim 無待決')
  assert.equal(missZh.remind.segs[0].color, P.idle)
  assert.notEqual(missZh.remind.segs[0].dim, true)
  assert.equal(missZh.remind.clickable, true, 'missing reminder remains clickable to inspect source')

  const missEn = B.layoutOneRowBand(missingBoth, 195, tEn)
  assert.ok(segText(missEn.remind).includes('Pending data missing'), 'missing en shows Pending data missing: ' + segText(missEn.remind))
  assert.equal(segText(missEn.remind).includes('No pending'), false, 'missing en must NOT claim No pending')

  const missPendOnly = B.layoutOneRowBand(sampleInput({
    reminder: { text: null, state: 'normal', hasRec: false },
    pend: { count: null, hasRec: false, state: 'missing' },
  }), 195, tZh)
  assert.ok(segText(missPendOnly.remind).includes('待決資料缺失'), 'null/missing pend count never falls back to 無待決')
  assert.equal(segText(missPendOnly.remind).includes('無待決'), false)

  for (const staleInp of [
    sampleInput({ reminder: { text: null, state: 'stale', hasRec: false }, pend: { count: 0, hasRec: false, state: 'stale' } }),
    sampleInput({ reminder: { text: null, state: 'normal', hasRec: false }, pend: { count: 0, hasRec: false, state: 'stale' } }),
  ]) {
    const staleZero = B.layoutOneRowBand(staleInp, 195, tZh)
    const remTxt = segText(staleZero.remind).trimEnd()
    assert.equal(remTxt, '~無待決?', 'stale 0-pending must mark ~ and ? instead of confirmed 無待決: ' + remTxt)
    assert.equal(staleZero.remind.segs[0].color, P.idle)
    assert.notEqual(staleZero.remind.segs[0].dim, true)
    assert.equal(staleZero.remind.clickable, true, 'stale reminder stays clickable')
  }

  const normalZeroZh = B.layoutOneRowBand(sampleInput({
    reminder: { text: null, state: 'normal', hasRec: false },
    pend: { count: 0, hasRec: false, state: 'normal' },
  }), 195, tZh)
  assert.equal(segText(normalZeroZh.remind).trimEnd(), '無待決')
  assert.equal(normalZeroZh.remind.clickable, false)

  const normalZeroEn = B.layoutOneRowBand(sampleInput({
    reminder: { text: null, state: 'normal', hasRec: false },
    pend: { count: 0, hasRec: false, state: 'normal' },
  }), 195, tEn)
  assert.equal(segText(normalZeroEn.remind).trimEnd(), 'No pending')
  assert.equal(normalZeroEn.remind.clickable, false)
})

// Traceability s1 (G01 / G02 / G15): line -> 3 (dispatch), source -> 6 (hygiene), prefixes & bottom hints align in zh-TW and en.
test('trace-s1: G01 line routes to 3 (dispatch), G02 source routes to 6 (hygiene), and bandBottomHint aligns in zh-TW and en', () => {
  for (const [loc, t] of [['zh-TW', tZh], ['en', tEn]]) {
    const lineFull = B.formatLineFull({ stalled: 4, running: 120, failed: 2, waiting: 0, state: 'normal' }, t)
    assert.equal(lineFull.page, 'dispatch', loc + ': full line routes to dispatch')
    assert.ok(segText(lineFull).startsWith('3 '), loc + ': normal line starts with 3 ')
    assert.equal(W.displayWidth(segText(lineFull)), B.BAND_COL_WIDTHS.line, loc + ': line width 26')

    const lineStale = B.formatLineFull({ stalled: 4, running: 120, failed: 2, waiting: 0, state: 'stale' }, t)
    assert.equal(lineStale.page, 'dispatch', loc + ': stale line routes to dispatch')
    assert.ok(segText(lineStale).startsWith('~3'), loc + ': stale line starts with ~3')

    const lineShort = B.formatLineShort({ stalled: 4, running: 3, failed: 2, waiting: 0, state: 'normal' }, t)
    assert.equal(lineShort.page, 'dispatch', loc + ': short line routes to dispatch')
    assert.ok(segText(lineShort).startsWith('3 '), loc + ': short line starts with 3 ')

    const srcNorm = B.formatSource({ label: '開發', flags: 120, state: 'normal' }, t)
    assert.equal(srcNorm.page, 'hygiene', loc + ': source routes to hygiene')
    assert.ok(segText(srcNorm).startsWith('6 '), loc + ': normal source starts with 6 ')
    assert.equal(W.displayWidth(segText(srcNorm)), B.BAND_COL_WIDTHS.source, loc + ': source width 16')

    const srcStale = B.formatSource({ label: '開發', flags: 120, state: 'stale' }, t)
    assert.equal(srcStale.page, 'hygiene', loc + ': stale source routes to hygiene')
    assert.ok(segText(srcStale).startsWith('~6'), loc + ': stale source starts with ~6')
  }
  const zhWide = B.bandBottomHint(120, false, tZh)
  assert.ok(zhWide.includes('3 派工') && zhWide.includes('6 殘留') && zhWide.includes('0 寵物'), 'zh-TW wide hint: ' + zhWide)
  assert.equal(zhWide.includes('8 待辦'), false, 'zh-TW hint drops unwired 8 route: ' + zhWide)
  const enWide = B.bandBottomHint(120, false, tEn)
  assert.ok(enWide.includes('3 Dispatch') && enWide.includes('6 Hygiene') && enWide.includes('0 Pet'), 'en wide hint: ' + enWide)
  assert.equal(enWide.includes('8 Todo'), false, 'en hint drops unwired 8 route: ' + enWide)
})

test('glyph disambiguation: band reminder uses ‣ (U+2023), not fold marker ▸ (GLYPHS.structure.folded)', () => {
  const lay = B.layoutOneRowBand(sampleInput(), 195, tZh)
  const rem = segText(lay.remind)
  assert.ok(rem.startsWith('\u2023 '), 'reminder starts with ‣ : ' + rem)
  assert.equal(rem.includes(G.structure.folded), false, 'reminder does not reuse fold glyph ▸: ' + rem)
  assert.equal(W.displayWidth('\u2023'), 1, '‣ is width 1')
})
