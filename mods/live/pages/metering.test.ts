// mods/live/pages/metering.test.ts — r5 coverage rows on the spend page.
import { test, expect } from 'claude-code/testing'
import { makeT } from '../i18n'
import { displayWidth } from '../model'
import { PALETTE } from '../../tux/palette.ts'
import { wideSpend } from '../wide/spend'
import { renderSpend } from './spend'
import { METER_WARN_COLOR, METER_WIDE_COLS, meteringPaneBlock, meteringRows, meteringWideRows, parseMeterPack } from './metering'
import { BAND_LIST_COLS } from '../wide/geometry'
import { wideBand } from '../wide/band'
import { paneUpper, PANE_INNER } from '../wide/pane'
import type { MeterPack } from './metering'

const t = makeT('zh-TW')
const NOW = Date.UTC(2026, 10, 18, 4, 0, 0)
const text = (row: { text: string }[]): string => row.map(s => s.text).join('')

const pack = (coverage: Record<string, unknown>, evidence?: unknown): string => JSON.stringify({
  generated_at: '2026-11-27T00:15:00Z',
  coverage,
  ...(evidence === undefined ? {} : { evidence }),
})

test('parseMeterPack accepts a coverage document and evidence_gate, and rejects malformed text', () => {
  const ok = parseMeterPack(pack({
    h1: { expected: 136, got: 87, missing: 49, retention_days: 7, no_data: false },
  }, { lines: [], hard_rejects: 0, evaluated: 0 }))
  expect(ok).not.toBeNull()
  expect(ok!.hosts).toEqual([{ host: 'h1', expected: 136, got: 87, missing: 49, retention_days: 7, no_data: false }])
  expect(ok!.evidenceLines).toBe(0)
  const wrapped = parseMeterPack(JSON.stringify({ evidence_gate: JSON.parse(pack({ a: { expected: 1, got: 1, missing: 0, retention_days: 7, no_data: false } })) }))
  expect(wrapped?.hosts[0]?.host).toBe('a')
  expect(parseMeterPack('{')).toBeNull()
  expect(parseMeterPack('null')).toBeNull()
  expect(parseMeterPack(JSON.stringify({ coverage: { h: { expected: 'x', got: 1, missing: 0, retention_days: 1 } } }))).toBeNull()
  expect(parseMeterPack(JSON.stringify({ coverage: [] }))).toBeNull()
})

test('87/136 host row text is exact, >10% uses the warn colour, <=10% does not', () => {
  const hi = meteringRows(parseMeterPack(pack({
    h1: { expected: 136, got: 87, missing: 49, retention_days: 7, no_data: false },
  }, { lines: ['x'] })), NOW, t)
  const row = hi.find(r => text(r).includes('87/136'))!
  expect(text(row)).toBe(' h1  覆蓋 87/136（缺 49）· 保留 7 日')
  expect(row.some(s => s.color === METER_WARN_COLOR)).toBe(true)
  const lo = meteringRows(parseMeterPack(pack({
    h1: { expected: 100, got: 90, missing: 10, retention_days: 7, no_data: false },
  }, { lines: ['x'] })), NOW, t)
  const quiet = lo.find(r => text(r).includes('90/100'))!
  expect(quiet.every(s => s.color !== METER_WARN_COLOR)).toBe(true)
})

test('host names share one displayWidth prefix, including a CJK name and a no-data row', () => {
  const rows = meteringRows(parseMeterPack(pack({
    ab: { expected: 10, got: 10, missing: 0, retention_days: 7, no_data: false },
    主機: { expected: 10, got: 8, missing: 2, retention_days: 7, no_data: false },
    甲: { expected: 10, got: 0, missing: 10, retention_days: 3, no_data: true },
  }, { lines: ['kept'] })), NOW, t)
  const hostRows = rows.filter(r => /覆蓋 \d|無資料/.test(text(r)))
  expect(hostRows.map(text)).toContain(' 甲    無資料')
  const prefixes = hostRows.map(r => {
    const s = text(r)
    return displayWidth(s.slice(0, s.search(/覆蓋 \d|無資料/)))
  })
  expect(new Set(prefixes).size).toBe(1)
  expect(prefixes[0]).toBe(displayWidth(' 主機  '))
})

test('empty evidence.lines adds the producer row; a missing pack is one broken row and no invented count', () => {
  const empty = meteringRows(parseMeterPack(pack({
    h1: { expected: 10, got: 10, missing: 0, retention_days: 7, no_data: false },
  }, { lines: [] })), NOW, t)
  expect(empty.map(text).join('\n')).toContain('證據：尚無生產者（約 11-30）')
  const absent = meteringRows(parseMeterPack(pack({
    h1: { expected: 10, got: 10, missing: 0, retention_days: 7, no_data: false },
  })), NOW, t)
  expect(absent.map(text).join('\n')).toContain('證據：尚無生產者（約 11-30）')
  const broken = meteringRows(null, NOW, t)
  expect(broken).toHaveLength(1)
  expect(text(broken[0])).toContain('無來源：計量覆蓋檔不存在或讀不了')
  expect(text(broken[0])).not.toMatch(/\d/)
  expect(broken[0][0].color).toBe(PALETTE.broken)
})

test('renderSpend places metering after the pool rows on the narrow page, and wideSpend appends the same lines', () => {
  const parsed = parseMeterPack(pack({
    h1: { expected: 136, got: 87, missing: 49, retention_days: 7, no_data: false },
  }, { lines: [] })) as MeterPack
  const body = renderSpend({ live: null, console: null, size: { cols: 120, rows: 40 }, t, nowMs: NOW, meter: parsed }).body.map(text)
  const poolAt = body.findIndex(r => r.includes('沒有 console') || r.includes('額度池') || r.includes('無來源'))
  const meterAt = body.findIndex(r => r.includes('87/136'))
  expect(meterAt).toBeGreaterThan(poolAt)
  expect(body.join('\n')).toContain('計量覆蓋')
  const wide = wideSpend({
    pct5h: null, reset5h: null, eta5h: null, hitBeforeReset: null, ratePerHour: null, pct7d: null, reset7d: null,
    pools: [], todayTokens: null, tps: null, seatUsage: [], stale: false, missing: true,
    meterLines: [' h1  覆蓋 87/136（缺 49）· 保留 7 日'],
  })
  expect(wide.list[wide.list.length - 1]).toContain('87/136')
})

test('meter warn colour stays >= 4.5:1 on light and dark; attention yellow does not', () => {
  const luminance = (rgb: number[]) => rgb.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0)
  const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
  expect(METER_WARN_COLOR).toBe(PALETTE.action)
  expect(METER_WARN_COLOR).toBe('remember')
  // 256-colour yellow (attention) on light is under 4.5:1. remember is blue on light and periwinkle on dark.
  expect(contrast([187, 187, 0], [255, 255, 255])).toBeLessThan(4.5)
  for (const bg of [[255, 255, 255], [245, 245, 245]]) expect(contrast([0, 0, 255], bg)).toBeGreaterThanOrEqual(4.5)
  for (const bg of [[0, 0, 0], [30, 30, 30]]) expect(contrast([180, 180, 255], bg)).toBeGreaterThanOrEqual(4.5)
})

const SAMPLE = pack({
  '4124gs': { expected: 137, got: 88, missing: 49, retention_days: 7, no_data: false },
  c4140: { expected: 81, got: 86, missing: 5, retention_days: 4, no_data: false },
  xl270d: { expected: 137, got: 125, missing: 12, retention_days: 7, no_data: false },
}, { lines: [] })

test('wide band rows: every row of the sample pack and of 8-character hosts with 3-digit counts fits the list column, with no ellipsis', () => {
  expect(METER_WIDE_COLS).toBe(BAND_LIST_COLS - 2)
  const big = pack({
    abcdefgh: { expected: 999, got: 998, missing: 100, retention_days: 14, no_data: false },
    hostname8: { expected: 100, got: 100, missing: 0, retention_days: 7, no_data: false },
    短: { expected: 10, got: 0, missing: 10, retention_days: 3, no_data: true },
  }, { lines: [] })
  for (const raw of [SAMPLE, big, pack({ h: { expected: 1, got: 1, missing: 0, retention_days: 1, no_data: false } }, { lines: ['x'] })]) {
    for (const row of meteringWideRows(parseMeterPack(raw), NOW, t)) {
      expect(displayWidth(row.text), row.text).toBeLessThanOrEqual(METER_WIDE_COLS)
      expect(row.text).not.toContain('…')
    }
  }
  expect(meteringWideRows(null, NOW, t).map(r => displayWidth(r.text)).every(n => n <= METER_WIDE_COLS)).toBe(true)
  expect(meteringWideRows(parseMeterPack(SAMPLE), NOW, t).map(r => r.text)).toEqual([
    '▾ 計量覆蓋', '4124gs 88/137 缺 49 · 留 7 日', 'c4140  86/81 缺 5 · 留 4 日', 'xl270d 125/137 缺 12 · 留 7 日', '證據：尚無生產者（約 11-30）',
  ])
})

test('wide band rows: only the row over 10% is warn, and the band draws it in the action role while the others stay plain', () => {
  const rows = meteringWideRows(parseMeterPack(SAMPLE), NOW, t)
  expect(rows.filter(r => r.warn).map(r => r.text)).toEqual(['4124gs 88/137 缺 49 · 留 7 日'])
  const band = wideBand({ page: 5, tabs: ['現況', '待決', '派工', '審查', '花費', '殘留', '艦隊', '待辦', '說明'], stepTitle: '正常', list: rows.map(r => (r.warn ? { text: r.text, role: 'action' as const } : r.text)), reply: [], status: '', hints: '' })
  const drawn = band.segs.flat()
  expect(drawn.filter(sg => sg.role === 'action').map(sg => sg.text)).toEqual(['4124gs 88/137 缺 49 · 留 7 日'])
  expect(band.rows.join('\n')).not.toContain('…')
  expect(band.rows.every(r => displayWidth(r) === 110)).toBe(true)
})

test('wide pane block: the three long-form host rows and the evidence row, the over-10% row in the action role, the lanes left out; other pages keep their lanes', () => {
  const block = meteringPaneBlock(parseMeterPack(SAMPLE), NOW, t)
  expect(block.head).toBe('計量覆蓋')
  expect(block.rows.map(r => r.text)).toEqual([' 4124gs  覆蓋 88/137（缺 49）· 保留 7 日', ' c4140   覆蓋 86/81（缺 5）· 保留 4 日', ' xl270d  覆蓋 125/137（缺 12）· 保留 7 日', ' 證據：尚無生產者（約 11-30）'])
  expect(block.rows.map(r => r.warn)).toEqual([true, false, false, false])
  const lanes = [{ state: 'running' as const, name: 'lane-a', speed: '1 tok/s', task: 'x' }]
  const base = { page: 5, tabs: ['現況', '待決', '派工', '審查', '花費', '殘留', '艦隊', '待辦', '說明'], moved: [], more: [], pin: [], ctx: [], ctxFold: false, ctxOpen: false, lanes, lanesHead: '艦隊 · 1 條產線', hist: null, events: null, summaries: Array.from({ length: 9 }, () => null) }
  const withMeter = paneUpper({ ...base, meter: { head: block.head, rows: block.rows.map(r => ({ text: r.text, role: r.warn ? 'action' as const : 'text' as const })) } })
  const text5 = withMeter.map(r => r.map(p => p[0]).join(''))
  expect(text5).toContain('計量覆蓋')
  expect(text5.filter(x => /覆蓋 \d/.test(x))).toHaveLength(3)
  expect(text5.join('\n')).not.toContain('艦隊 ·')
  expect(withMeter.flat().filter(p => p[1] === 'action').map(p => p[0])).toEqual([' 4124gs  覆蓋 88/137（缺 49）· 保留 7 日'])
  expect(withMeter.every(r => displayWidth(r.map(p => p[0]).join('')) <= PANE_INNER)).toBe(true)
  const other = paneUpper({ ...base, page: 7 }).map(r => r.map(p => p[0]).join(''))
  expect(other.join('\n')).toContain('艦隊 · 1 條產線')
  expect(other.join('\n')).not.toContain('計量覆蓋')
  const broken = meteringPaneBlock(null, NOW, t)
  expect(broken.rows).toHaveLength(1)
  expect(broken.rows[0].text).not.toMatch(/\d/)
})
