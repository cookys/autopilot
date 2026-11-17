// gate1.test.ts — UX gate round 1 (98f70cbe6) findings G1-G10: each test reproduces one finding; the screens are the frame's, drawn from the shared console fixture.
import { test, expect } from 'claude-code/testing'
import { frameRows } from './pages/frame'
import { nowPage } from './pages/now'
import { fleetPage } from './pages/fleet'
import { quotaPage, renderQuota } from './pages/quota'
import { PAGES } from './pages/index'
import { classify, normalizedPools, worstPool } from './pages/quota-pick'
import { bandQuotaSeg } from './band'
import { consoleOf, POOLS, ctxOf, NOW, type Sources } from './pages/quota.fixture'
import { makeT } from './i18n'
import { PALETTE } from './ui'
import type { ConsoleSnapshot } from './console'

const t = makeT('zh-TW')
const OK = (n: string): { at_ms: number; state: 'ok' } => ({ at_ms: NOW - 40000, state: 'ok' })
const ALL_OK: Sources = { tasks: OK('t'), hosts: OK('h'), cards: OK('c'), quota_now: OK('q'), quota_forecast: OK('f') }
const text = (r: { text: string }[]): string => r.map(s => s.text).join('')
const snap = (pools: unknown[] = POOLS, o: Parameters<typeof consoleOf>[1] = {}): ConsoleSnapshot => consoleOf(pools, { sources: ALL_OK, ...o }) as ConsoleSnapshot
const pageOf = (id: string) => PAGES.find(p => p.id === id) ?? nowPage
const screen = (p: Parameters<typeof frameRows>[0], cols: number, rows: number, c: unknown): string[] => frameRows(p, ctxOf(cols, rows, c) as never).map(text)
const SIZES: [number, number][] = [[80, 24], [120, 30], [160, 40]]
const pages = [['now', nowPage], ['fleet', fleetPage], ['quota', quotaPage]] as const

test('gate G1 (gate 2 layout): exactly H rows, the row above the strip has content, page separators only; 80x24 現況 keeps content rows', () => {
  for (const [name, p] of pages) for (const [cols, rows] of SIZES) {
    const out = screen(p, cols, rows, snap())
    const body = out.slice(1, -1)
    expect(body[body.length - 1]?.trim(), name + ' ' + cols + 'x' + rows + ': the row above the strip has content').not.toBe('')
    expect(out.length, 'exactly the pane height').toBe(rows)
  }
  expect(screen(nowPage, 80, 24, snap()).slice(1, -1).filter(l => l.trim() !== '').length).toBeGreaterThanOrEqual(3)
})

test('gate G2: 現況 at 80 columns: pending count + oldest card title, then stuck lines, then every red pool in full', () => {
  const c = snap()
  const out = screen(nowPage, 80, 30, c)
  const oldest = [...(c.cards ?? [])].sort((a, b) => a.opened_at_ms - b.opened_at_ms)[0]
  const first = out.slice(1).find(l => l.trim() !== '') as string
  expect(first, 'the first content row is the pending count').toContain('待決')
  expect(first, 'and carries the oldest card title').toContain(oldest.question.slice(0, 6))
  const iStuck = out.findIndex(l => l.includes('復原線成員離線'))
  const names = ['trinity', 'twgame', 'personal', 'team']
  const at = names.map(n => out.findIndex(l => l.includes(n) && l.includes('池') === false || l.includes(n)))
  expect(iStuck, 'stuck lines are on the page').toBeGreaterThan(0)
  for (const n of names) expect(out.findIndex((l, i) => i > iStuck && l.includes(n)), n + ' is listed after the stuck lines').toBeGreaterThan(iStuck)
  expect(at.length).toBe(4)
  expect(out.join('\n')).not.toMatch(/\+\d+/)
})

test('gate G3: one production-line total on every page, and shown + folded = total', () => {
  const c0 = snap()
  const l0 = (c0.lines as NonNullable<ConsoleSnapshot['lines']>)[0]
  const c = { ...c0, counts: { ...c0.counts, summary: { ...c0.counts.summary, lines: { running: 2, waiting: 1, stalled: 6 } } }, lines: Array.from({ length: 8 }, (_, i) => ({ ...l0, line_id: 'L' + i, label: 'L' + i })) } as ConsoleSnapshot
  const a = screen(nowPage, 160, 40, c).join('\n').match(/產線 (\d+)/)
  const b = screen(fleetPage, 160, 40, c).join('\n').match(/產線 (\d+)/)
  expect(a?.[1]).toBe('9')
  expect(b?.[1], '艦隊 says the same total').toBe(a?.[1])
  const fold = screen(fleetPage, 160, 40, c).join('\n').match(/（(\d+)\+(\d+)=(\d+)）/)
  expect(fold, 'the fold line states the arithmetic').not.toBeNull()
  expect(Number(fold?.[1]) + Number(fold?.[2])).toBe(Number(fold?.[3]))
  expect(fold?.[3]).toBe('9')
})

test('gate G4: missing data never reads as nothing to do; red pools never read 沒有要你處理的事', () => {
  const miss = snap(POOLS, { sources: { ...ALL_OK, quota_forecast: { at_ms: null, state: 'no_source' } } })
  for (const [, p] of pages) {
    const out = screen(p, 120, 30, miss)
    expect(out.join('\n')).not.toContain('沒有要你處理的事')
  }
  expect(screen(quotaPage, 120, 30, miss).slice(-2, -1)[0]).toContain('資料不足，無法判定')
  const known = snap(POOLS.map(p => ({ ...p, stranded_seats: 1 })))
  expect(screen(quotaPage, 120, 30, known).slice(-2, -1)[0], 'all sources ok, every verdict known: the scoped line').toContain('沒有待決卡')
  expect(screen(quotaPage, 120, 30, null).slice(-2, -1)[0]).toContain('資料不足，無法判定')
  expect(screen(nowPage, 160, 40, miss).join('\n'), '現況 does not claim 沒有例外 beside red data').not.toContain('沒有例外')
})

test('gate G5: a used-up pool with no rebalance data is unknown (warning role, names the missing data and capacity); order red > unknown > yellow > green', () => {
  const p = (name: string) => normalizedPools(snap())!.find(x => x.pool === name)!
  const v = classify(p('personal'), NOW, true, t)
  expect(v.role).toBe('warning')
  expect(v.text).toContain('缺換池資料')
  expect(v.text).toContain('capacity')
  const team = classify(p('team'), NOW, true, t)
  expect(team.role, 'a forecast exhaustion with no switch data is unknown too').toBe('warning')
  const unk = [p('personal'), p('grok')]
  expect(worstPool(unk, NOW, t)?.pool, 'unknown before yellow').toBe('personal')
  expect(worstPool([...unk, p('trinity')], NOW, t)?.pool, 'red before unknown').toBe('trinity')
  const quotaRow = screen(quotaPage, 160, 40, snap()).find(l => l.includes('personal') && l.includes('✗') === false && l.includes('未知·缺換池'))
  expect(quotaRow, '額度 table row shows the short unknown verdict').toBeDefined()
  const focusDetail = renderQuota(ctxOf(160, 40, snap()) as never, { focus: 3, expanded: false }).body.map(text).join('\n')
  expect(focusDetail, 'focused personal pool shows full verdict in focus area').toContain('缺換池資料（capacity）')
  const now = nowPage.render(ctxOf(160, 40, snap()) as never).body.flat().find(s => s.text.includes('缺換池資料'))
  expect(now?.color, '現況 draws unknown at the warning level').toBe(PALETTE.attention)
  const noRed = normalizedPools(snap())!.filter(x => x.pool === 'personal' || x.pool === 'grok')
  const band = bandQuotaSeg(noRed, NOW, t, 'ok')
  expect(band?.text).toContain('缺換池資料')
  expect(band?.color).toBe(PALETTE.attention)
})

test('gate G6: a stale reason is wrapped, never cut with an ellipsis', () => {
  const c = snap()
  for (const [cols, rows] of [[60, 30], [80, 24], [120, 30]] as [number, number][]) {
    const out = screen(quotaPage, cols, rows, c)
    expect(out.filter(l => !l.includes('還有')).some(l => l.endsWith('…')), 'quota ' + cols + ': no row ends in an ellipsis').toBe(false)
    expect(out.join('').replace(/\s+/g, ''), 'the whole reason is on screen').toContain('statusline沒在跑')
  }
  const now = screen(nowPage, 60, 40, snap())
  expect(now.filter(l => !l.includes('還有')).some(l => l.endsWith('…'))).toBe(false)
})

test('gate G7: when the strip does not fit every entry 1-8, 9, 0 and i stays, names shorten first (2 rows under 66 columns)', () => {
  for (const cols of [100, 70, 60, 50, 40]) {
    const out = screen(nowPage, cols, 30, snap())
    const strip = (cols < 66 ? out.slice(-2) : out.slice(-1)).join(' ')
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'i']) expect(strip, 'cols ' + cols + ' keeps ' + k).toMatch(new RegExp('(^|\\s)' + k + '(\\s|$)'))
    expect(strip.includes('…'), 'cols ' + cols + ': no fold').toBe(false)
  }
})

test('gate G8: percentages are right-aligned, the % signs line up in columns', () => {
  const out = screen(quotaPage, 160, 40, snap()).filter(l => /^[▸ ] [✗▲✓] \S/.test(l) && l.includes('%'))
  expect(out.length).toBeGreaterThanOrEqual(5)
  const col = (l: string, nth: number): number => { let i = -1; for (let k = 0; k <= nth; k++) i = l.indexOf('%', i + 1); return [...l.slice(0, i)].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0) }
  for (const nth of [0, 1]) expect(new Set(out.map(l => col(l, nth))).size, '% column ' + nth + ' is one column').toBe(1)
})

test('gate G9: no raw field names on any framed page at three sizes', () => {
  const bad = [/burn_window_h/, /limit_hit/, /quota_forecast/, /stranded_seats/, /pool_key/, /\b7d\b/, /\b5h\b/, /capacity pace/]
  const miss = snap(POOLS, { sources: { ...ALL_OK, quota_forecast: { at_ms: null, state: 'no_source' }, hosts: { at_ms: NOW - 3_600_000, state: 'expired' } } })
  // the exception texts are the feed's own words (not ours): the fixture's `A 池 5h 快滿` is replaced so the scan covers what the pane writes
  const own = (c: ConsoleSnapshot): ConsoleSnapshot => ({ ...c, items: c.items.map(i => ({ ...i, text: i.text.replace('5h', '5 時'), title: i.title.replace('5h', '5 時') })) })
  for (const c of [own(snap()), own(miss)]) for (const [, p] of pages) for (const [cols, rows] of SIZES) {
    const s = screen(p, cols, rows, c).join('\n')
    for (const re of bad) expect(s, p.id + ' ' + cols + 'x' + rows + ' shows ' + re).not.toMatch(re)
  }
})

test('gate G10: one set of names: pool "F 池" on every page, line states 離線 / 閒置 / 卡住', () => {
  const pools = [...POOLS, { ...POOLS[1], pool: 'pool-f', seven_day_pct: 100, five_hour_pct: 100, limit_hit: true, stranded_seats: 2 }]
  const c = snap(pools)
  for (const p of [quotaPage, nowPage]) expect(screen(p, 160, 40, c).join('\n'), p.id).not.toContain('pool-f')
  expect(screen(quotaPage, 160, 40, c).join('\n')).toContain('F 池')
  const c0 = snap()
  const l0 = (c0.lines as NonNullable<ConsoleSnapshot['lines']>)[0]
  const mk = (id: string, issues: unknown[]) => ({ ...l0, line_id: id, label: id, issues })
  const issue = (rule: string) => ({ ...l0.issues[0], rule, state: 'stalled', since_ms: NOW - 3_600_000 })
  const c2 = { ...c0, lines: [mk('甲', [issue('member_offline')]), mk('乙', []), mk('丙', [issue('wait_untyped')])] } as ConsoleSnapshot
  const out = screen(fleetPage, 160, 40, c2)
  expect(out.find(l => l.includes('甲'))).toContain('離線')
  expect(out.find(l => l.includes('乙'))).toContain('閒置')
  expect(out.find(l => l.includes('丙'))).toContain('卡住')
  expect(out.join('\n')).not.toContain('無異常')
})
