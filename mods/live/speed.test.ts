// mods/live/speed.test.ts — the speed measurement (BL-0359), pure half: the rate window, the summary, the label parts and the speed view's lines and colours.
// The mounted half (the hook that times a real stream, the label on the band, the open tab) is in live.test.ts ("speed tab: ...").
// Run through `bash mods/live/run-tests.sh`. The method is codeforge 405b214's `stepRate`; the numbers pinned below are the 2026-11-02 case that showed 3578 tok/s for ~83.
import { test, expect } from 'claude-code/testing'
import { makeT } from './i18n'
import { isStep, fmtCount, fmtMs, fmtTps, KEEP_STEPS, MIN_DECODE_MS, petTag, recentTimed, serverToolMs, STEPS_SHAPE, stepRate, summarize, validSteps } from './speed'
import type { Step } from './speed'
import { COL_GAP, RECENT_W, recentColumn, SPEED_COL_W, SPEED_ROWS, speedColumn, speedLabelParts, speedView, sparkline } from './speedview'
import * as ui from './ui'

const step = (over: Partial<Step> = {}): Step => ({ at: 1, model: 'claude-opus-5-5', isSubagent: false, ttftMs: 1000, decodeMs: 2000, outTokens: 200, tps: 100, ...over })

// The window the label used before BL-0359 (forge-stats until 405b214): first chunk -> last chunk, whatever streamed. Kept here only as the negative control's yardstick.
const oldWindow = (t: { first: number; last: number; outTokens: number }) => t.outTokens / ((t.last - t.first) / 1000)

test('stepRate: the 2026-11-02 case, 773 tokens after 9.1 s of hidden thinking and 0.216 s of text, reads ~83 tok/s and not 3578', () => {
  const hidden = stepRate({ sent: 0, first: 9100, last: 9316, outTokens: 773, thinkingStreamed: false, serverToolMs: 0 })
  expect(hidden.decodeMs).toBe(9316)
  expect(Math.round(hidden.tps ?? 0)).toBe(83)
  expect(hidden.tps ?? 0).toBeLessThan(100)
})

test('stepRate negative control: the old first -> last window reads 3578 on the same numbers, so the pin above goes red under it', () => {
  expect(Math.round(oldWindow({ first: 9100, last: 9316, outTokens: 773 }))).toBe(3579)
  const rate = stepRate({ sent: 0, first: 9100, last: 9316, outTokens: 773, thinkingStreamed: false, serverToolMs: 0 }).tps ?? 0
  expect(rate).not.toBeGreaterThan(oldWindow({ first: 9100, last: 9316, outTokens: 773 }) / 10) // an inflated window would fail here
})

test('stepRate: thinking streamed as text counts from the first chunk, the API\'s own tool time (the advisor) is no writing time', () => {
  const shown = stepRate({ sent: 0, first: 900, last: 9316, outTokens: 773, thinkingStreamed: true, serverToolMs: 0 })
  expect(shown.decodeMs).toBe(8416)
  const advisor = stepRate({ sent: 0, first: 9100, last: 9316, outTokens: 773, thinkingStreamed: false, serverToolMs: 5000 })
  expect(advisor.decodeMs).toBe(4316)
  expect(stepRate({ sent: 0, first: 9100, last: 9316, outTokens: 773, thinkingStreamed: false, serverToolMs: 99_999 }).decodeMs, 'never negative').toBe(0)
})

test('stepRate: a window under 150 ms, nothing written, or nothing streamed has no rate', () => {
  expect(MIN_DECODE_MS).toBe(150)
  expect(stepRate({ sent: 0, first: 10, last: 100, outTokens: 5, thinkingStreamed: true, serverToolMs: 0 }).tps).toBe(null)
  expect(stepRate({ sent: 0, first: 10, last: 150, outTokens: 5, thinkingStreamed: true, serverToolMs: 0 }).tps, 'exactly 140 ms is still short').toBe(null)
  expect(stepRate({ sent: 0, first: 10, last: 160, outTokens: 5, thinkingStreamed: true, serverToolMs: 0 }).tps, 'exactly 150 ms is timed').not.toBe(null)
  expect(stepRate({ sent: 0, first: 10, last: 900, outTokens: 0, thinkingStreamed: false, serverToolMs: 0 }).tps).toBe(null)
  expect(stepRate({ sent: 0, first: null, last: null, outTokens: 50, thinkingStreamed: false, serverToolMs: 0 })).toEqual({ decodeMs: null, tps: null })
})

test('serverToolMs: a tool with an end is subtracted, one without (the advisor) is not', () => {
  expect(serverToolMs(undefined)).toBe(0)
  expect(serverToolMs([{ startedAt: 100, endedAt: 600 }, { startedAt: 700 }, { startedAt: 900, endedAt: 1000 }])).toBe(600)
  expect(serverToolMs([{ startedAt: 900, endedAt: 800 }]), 'a clock that ran backwards subtracts nothing').toBe(0)
})

test('the stored list: 200 kept, the shape tag steps-2 (a list under another tag is dropped by the state layer), anything that is not a list is empty', () => {
  expect(KEEP_STEPS).toBe(200)
  expect(STEPS_SHAPE).toBe('steps-2')
  expect(validSteps(undefined)).toEqual([])
  expect(validSteps({ a: 1 })).toEqual([])
})

test('validSteps checks every field: a bad sample is dropped alone, the good ones stay', () => {
  const good = step()
  const bad: [string, unknown][] = [
    ['missing at', { ...good, at: undefined }],
    ['missing model', { ...good, model: undefined }],
    ['empty model', { ...good, model: '' }],
    ['model of the wrong type', { ...good, model: 5 }],
    ['isSubagent a string', { ...good, isSubagent: 'no' }],
    ['missing isSubagent', { ...good, isSubagent: undefined }],
    ['NaN outTokens', { ...good, outTokens: Number.NaN }],
    ['Infinity outTokens', { ...good, outTokens: Number.POSITIVE_INFINITY }],
    ['negative outTokens', { ...good, outTokens: -1 }],
    ['outTokens null (only the three timing fields may be null)', { ...good, outTokens: null }],
    ['negative at', { ...good, at: -5 }],
    ['negative tps', { ...good, tps: -3 }],
    ['NaN decodeMs', { ...good, decodeMs: Number.NaN }],
    ['string ttftMs', { ...good, ttftMs: '12' }],
    ['missing tps', { ...good, tps: undefined }],
    ['null', null],
    ['a string', 'x'],
  ]
  for (const [name, s] of bad) {
    expect(isStep(s), name).toBe(false)
    expect(validSteps([good, s, step({ model: 'kept' })]).map(x => x.model), name + ': the others survive').toEqual([good.model, 'kept'])
  }
  expect(isStep({ ...good, ttftMs: null, decodeMs: null, tps: null }), 'the three timing fields may be null').toBe(true)
  expect(isStep({ ...good, outTokens: 0, tps: 0 })).toBe(true)
})

test('summarize: the average is token-weighted (total tokens over total writing time), best and latest are the timed ones, the first-token delay is the median over all requests', () => {
  const list = [step({ outTokens: 100, decodeMs: 1000, tps: 100, ttftMs: 500 }), step({ outTokens: 900, decodeMs: 3000, tps: 300, ttftMs: 3000 }), step({ outTokens: 5, decodeMs: 50, tps: null, ttftMs: 1000 })]
  const s = summarize(list)
  expect(s.requests).toBe(3)
  expect(s.outTokens).toBe(1005)
  expect(s.avgTps).toBe(250) // 1000 tokens over 4 s, not the mean of 100 and 300 (200)
  expect(s.bestTps).toBe(300)
  expect(s.latestTps, 'the last request is too short to time: the latest rate is the last one that has one').toBe(300)
  expect(s.medianTtft).toBe(1000)
  expect(summarize([])).toMatchObject({ requests: 0, avgTps: null, bestTps: null, latestTps: null, medianTtft: null })
})

test('subagent requests are counted apart: the label and the statistics read the main conversation', () => {
  const list = [step({ tps: 100 }), step({ tps: 900, isSubagent: true }), step({ tps: 120 })]
  expect(recentTimed(list, 5).map(s => s.tps)).toEqual([100, 120])
  expect(speedLabelParts(list)?.find(g => g.role === 'value')?.text).toBe('120')
})

test('fmtMs / fmtTps: sub-second, seconds, minutes and the dash', () => {
  expect(fmtMs(840, '-')).toBe('840ms')
  expect(fmtMs(1234, '-')).toBe('1.2s')
  expect(fmtMs(14_900, '-')).toBe('14s')
  expect(fmtMs(125_000, '-')).toBe('2m05s')
  expect(fmtMs(null, '-')).toBe('-')
  expect(fmtTps(82.6, '-')).toBe('83')
  expect(fmtTps(null, '-')).toBe('-')
})

const HUGE = [1e30, Number.MAX_SAFE_INTEGER, 1e21, 1e15, 999_999.6, 1_000_000, 1.2e9, 123_456_789_012_345, 1e300, Number.MAX_VALUE]
const lineText = (l: { text: string }[]): string => l.map(g => g.text).join('')

test('fmt*: a stored sample can hold any number, but each number column keeps its width (abbreviated, never cut into a wrong number)', () => {
  for (const n of HUGE) {
    expect(ui.displayWidth(fmtTps(n, '-')), 'fmtTps ' + n).toBeLessThanOrEqual(RECENT_W.tps)
    expect(ui.displayWidth(fmtMs(n, '-')), 'fmtMs ' + n).toBeLessThanOrEqual(RECENT_W.ttft)
    expect(ui.displayWidth(fmtCount(n)), 'fmtCount ' + n).toBeLessThanOrEqual(RECENT_W.out)
  }
  expect(fmtCount(1_234_567)).toBe('1.2M')
  expect(fmtCount(999_999)).toBe('999,999')
  expect(fmtCount(999_999.6)).toBe('1.0M')
  expect(fmtTps(34_000_000, '-')).toBe('34M')
  expect(fmtCount(5.6e9)).toBe('5.6B')
  expect(fmtCount(1e30)).toBe('>999T')
  expect(fmtMs(4_500_000, '-')).toBe('1h15m')
  expect(fmtMs(1e30, '-')).toBe('>99h')
})

test('a stored sample with huge numbers never widens the recent table, the speed column or the label past their declared widths', () => {
  const t = makeT('en')
  for (const n of HUGE) {
    const big = step({ outTokens: n, ttftMs: n, decodeMs: n, tps: n })
    const tiny = step({ outTokens: n, ttftMs: n, decodeMs: 1e-30, tps: n }) // a rate over a near-zero window is huge too
    for (const steps of [[big], [big, big], [tiny, big, step()]]) {
      const recent = recentColumn(steps, 10, 46, t)
      for (const l of recent.lines) expect(ui.displayWidth(lineText(l)), 'recent ' + n).toBeLessThanOrEqual(recent.width)
      const col = speedColumn(steps, t)
      for (const l of col.lines) expect(ui.displayWidth(lineText(l)), 'speed column ' + n).toBeLessThanOrEqual(col.width)
      for (const l of speedView(steps, 10, 120, t).columns.flatMap(c => c.lines.map(x => ({ l: x, w: c.width })))) expect(ui.displayWidth(lineText(l.l))).toBeLessThanOrEqual(l.w)
      const label = speedLabelParts(steps, 'Ferris Lv.' + fmtCount(n)) ?? []
      expect(ui.displayWidth(label.find(g => g.role === 'value')?.text ?? ''), 'label value ' + n).toBeLessThanOrEqual(RECENT_W.tps)
    }
  }
  const pet = petTag(JSON.stringify({ schema: 'codeforge.pet-view/1', pet: { name: 'F', level: 1e30 } })) ?? ''
  expect(pet).toBe('F Lv.>999T')
})

test('petTag: codeforge.pet-view/1 with a pet is `Name Lv.N`; another schema, no pet, bad JSON and a missing file are null', () => {
  expect(petTag(JSON.stringify({ schema: 'codeforge.pet-view/1', pet: { name: 'Ferris', level: 1 } }))).toBe('Ferris Lv.1')
  expect(petTag(JSON.stringify({ schema: 'codeforge.pet-view/2', pet: { name: 'Ferris', level: 1 } }))).toBeNull()
  expect(petTag(JSON.stringify({ schema: 'codeforge.pet-view/1', pet: null }))).toBeNull()
  expect(petTag(JSON.stringify({ schema: 'codeforge.pet-view/1', pet: { name: '', level: 1 } }))).toBeNull()
  expect(petTag('{')).toBeNull()
  expect(petTag(null)).toBeNull()
})

test('speedLabelParts: nothing timed = no label; the latest rate, a trend from two timed requests, and the pet only when given', () => {
  expect(speedLabelParts([])).toBeNull()
  const one = speedLabelParts([step({ tps: 83.4 })]) ?? []
  expect(one.map(g => g.text).join('')).toBe('ϟ 83 tok/s')
  const two = speedLabelParts([step({ tps: 50 }), step({ tps: 100 })]) ?? []
  expect(two.map(g => g.text).join('')).toBe('ϟ 100 tok/s ▅█')
  expect((speedLabelParts([step({ tps: 50 }), step({ tps: 100 })], 'Ferris Lv.1') ?? []).map(g => g.text).join('')).toBe('ϟ 100 tok/s ▅█ · Ferris Lv.1')
  const dash = speedLabelParts([step({ tps: null })]) ?? []
  expect(dash.map(g => g.text).join('')).toBe('ϟ — tok/s')
})

test('speedLabelParts through forgeBar: the bolt and the trend are running, the number default, the unit dim, a speed of em dash idle as a whole, nothing bold', () => {
  const segs = ui.forgeBar(speedLabelParts([step({ tps: 50 }), step({ tps: 100 })], 'Ferris Lv.1') ?? []).segs
  const at = (text: string) => segs.find(g => g.text === text)
  expect(at('ϟ ')?.color).toBe(ui.PALETTE.running)
  expect(at('▅█')?.color).toBe(ui.PALETTE.running)
  expect(at('100')?.color).toBeUndefined()
  expect(at(' tok/s')?.dim).toBe(true)
  expect(at(' · ')?.color).toBe(ui.PALETTE.structure)
  expect(at('Ferris Lv.1')?.dim).toBe(true)
  expect(segs.every(g => g.bold !== true && g.color !== ui.PALETTE.here && g.color !== ui.PALETTE.done)).toBe(true)
  const idle = ui.forgeBar(speedLabelParts([step({ tps: null })]) ?? []).segs
  for (const text of ['ϟ ', '—', ' tok/s']) expect(idle.find(g => g.text === text)?.color, text).toBe(ui.PALETTE.idle)
})

test('speedLabelParts through forgeFit: the pet goes first, then the trend, the speed alone last', () => {
  const parts = speedLabelParts([step({ tps: 50 }), step({ tps: 100 })], 'Ferris Lv.1') ?? []
  const text = (cols: number) => (ui.forgeFit(parts, cols) ?? []).map(g => g.text).join('')
  expect(text(30)).toBe('ϟ 100 tok/s ▅█ · Ferris Lv.1')
  expect(text(20)).toBe('ϟ 100 tok/s ▅█')
  expect(text(12)).toBe('ϟ 100 tok/s')
  expect(ui.forgeFit(parts, 9)).toBeNull()
})

test('sparkline: scaled to the largest, a missing value is the lowest step', () => {
  expect(sparkline([0, 50, 100])).toBe('▁▅█')
  expect(sparkline([null, 100])).toBe('▁█')
  expect(sparkline([])).toBe('')
})

const textOfLine = (line: { text: string }[]) => line.map(g => g.text).join('')

for (const locale of ['zh-TW', 'en'] as const) {
  const t = makeT(locale)
  const steps = [step({ tps: 100, ttftMs: 1200, outTokens: 773, model: 'claude-opus-5-5' }), step({ tps: null, ttftMs: 400, decodeMs: 80, outTokens: 12, model: 'claude-haiku-4-5-20251001', isSubagent: true }), step({ tps: 80, ttftMs: 900, outTokens: 300 })]

  test('speed column (' + locale + '): title, average, best, latest, first token, trend and request count, the key column aligned in display cells', () => {
    const col = speedColumn(steps, t)
    expect(col.lines.length).toBeLessThanOrEqual(SPEED_ROWS)
    const lines = col.lines.map(textOfLine)
    expect(lines[0]).toContain(t('speed.title'))
    for (const key of ['speed.avg', 'speed.best', 'speed.latest', 'speed.first', 'speed.trend', 'speed.requests']) expect(lines.some(l => l.startsWith(t(key))), key).toBe(true)
    // the value starts in the same cell on every key row (a Chinese key is two cells a character)
    const starts = col.lines.slice(1).map(l => ui.displayWidth(l[0].text))
    expect(new Set(starts).size).toBe(1)
    expect(lines.find(l => l.startsWith(t('speed.avg')))).toContain('268') // (773+300) tokens over (2000+2000) ms: token-weighted over the timed main requests, the subagent's not counted
    expect(lines.find(l => l.startsWith(t('speed.best')))).toContain('100')
    expect(lines.find(l => l.startsWith(t('speed.latest')))).toContain('80')
    expect(lines.find(l => l.startsWith(t('speed.requests')))).toContain('2')
  })

  test('speed column (' + locale + '): no request says so, dim', () => {
    const col = speedColumn([], t)
    expect(textOfLine(col.lines[1])).toContain(t('speed.none'))
    expect(col.lines[1].every(g => g.dim === true)).toBe(true)
  })

  test('recent requests (' + locale + '): newest first, a subagent\'s row is dim and says so, a request with no rate shows the dash, the model is short', () => {
    const col = recentColumn(steps, 10, 46, t)
    const lines = col.lines.map(textOfLine)
    expect(lines[0]).toBe(t('reqs.title'))
    expect(lines[1]).toContain(t('reqs.model'))
    expect(lines[2]).toContain('opus-5-5') // the newest first: the last step is an opus one
    expect(lines[2]).toContain('300')
    expect(lines[3]).toContain('haiku-4-5')
    expect(lines[3]).toContain(t('reqs.sub'))
    expect(lines[3]).toContain('—')
    expect(col.lines[3].every(g => g.dim === true || g.color === ui.PALETTE.structure)).toBe(true)
    expect(lines.every(l => ui.displayWidth(l) <= 46)).toBe(true)
  })

  test('recent requests (' + locale + '): cut to the rows left (two go to the title and header)', () => {
    const many = Array.from({ length: 30 }, (_, i) => step({ outTokens: i + 1 }))
    expect(recentColumn(many, 8, 46, t).lines.length).toBe(8)
    expect(recentColumn(many, 1, 46, t).lines.length, 'never fewer than one request').toBe(3)
  })

  test('speed view (' + locale + '): every segment is a palette role or default text, no bold, no background, no inverse', () => {
    const roles = new Set<unknown>([undefined, ...Object.values(ui.PALETTE)])
    for (const col of [speedColumn(steps, t), recentColumn(steps, 10, 46, t)]) {
      for (const g of col.lines.flat()) {
        expect(roles.has(g.color), JSON.stringify(g)).toBe(true)
        expect(g.bold, JSON.stringify(g)).toBeUndefined()
        expect(Object.keys(g).sort().every(k => ['text', 'color', 'dim', 'role', 'here'].includes(k)), JSON.stringify(g)).toBe(true)
      }
    }
  })

  test('speed view (' + locale + '): the table joins the speed column only when its full 46 cells are left beside it, and `used` says what the mod below has left', () => {
    const wide = speedView(steps, 12, 120, t)
    expect(wide.columns.length).toBe(2)
    expect(wide.used).toBe(SPEED_COL_W + COL_GAP + 46)
    const mid = speedView(steps, 12, SPEED_COL_W + COL_GAP + 46, t)
    expect(mid.columns.length).toBe(2)
    expect(mid.columns[1].width).toBe(46)
    const narrow = speedView(steps, 12, SPEED_COL_W + COL_GAP + 45, t)
    expect(narrow.columns.length).toBe(1)
    expect(narrow.used).toBe(SPEED_COL_W)
  })

  test('speed view (' + locale + '): at every width it never draws wider than it was given (the table goes first, then the speed column shrinks) and under 26 cells it draws nothing', () => {
    for (const columns of [20, 25, 26, 30, 34, 36, 40, 60, 75, 76, 81, 82, 120]) {
      const v = speedView(steps, 12, columns, t)
      if (columns < 26) { expect(v.columns, 'columns=' + columns).toEqual([]); continue }
      expect(v.columns.length, 'columns=' + columns).toBeGreaterThan(0)
      const total = v.columns.reduce((n, c) => n + c.width, 0) + COL_GAP * (v.columns.length - 1)
      expect(total, 'columns=' + columns).toBeLessThanOrEqual(columns)
      expect(v.used, 'columns=' + columns).toBe(total)
      for (const c of v.columns) for (const line of c.lines) expect(ui.displayWidth(line.map(g => g.text).join('')), 'columns=' + columns + ' ' + JSON.stringify(line.map(g => g.text))).toBeLessThanOrEqual(c.width)
    }
  })
}
