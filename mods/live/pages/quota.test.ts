// V1/V4: percentages and verdicts name their data; o/prev/next live in the fixed action row.
// Z2: positive seat totals retain the count and explain the missing detail list.
// quota.test.ts — the 額度 page (plan r2 §4.1, g2 A1 / A3 / A7 / A10 / A11): golden rows of the mockup states, exactly H rows through frameRows at 160x40 / 120x30 / 80x24,
// the no-source rows, null staying null, the action area, the red markers (theme keys through PALETTE only, no background, no inverse).
// The goldens are the 額度 drawings of s0b/mockups.md row for row, with these known differences: the mockup's first line (seat, ages, branch) is the frame's header row, not the body;
// the frame bottom-anchors the body (blank rows ABOVE it) where the drawing top-anchors it; the failed glyph is GLYPHS.state.failed (✗), because ✖ is an emoji-risk glyph (EMOJI_BANNED).
import { test, expect } from 'claude-code/testing'
import { frameRows } from './frame'
import { PAGES, EXTRA_PAGES } from './index'
import { PALETTE } from '../../tux/palette.ts'
import { displayWidth } from '../../tux/width.ts'
import { quotaPage, renderQuota, rowsWrappedLen } from './quota'
import { classify, normalizedPools, rankPools, worstPool } from './quota-pick'
import { NOW, POOLS, SEATS, MIN, consoleOf, ctxOf } from './quota.fixture'

const text = (row: { text: string }[]) => row.map(s => s.text).join('').trimEnd()
const page = EXTRA_PAGES.find(p => p.id === 'quota') as never
const A = (rows: number) => (rows >= 32 ? 6 : 4)
const SIZES = [[160, 40], [120, 30], [80, 24]] as const
const NOPACE = POOLS.map(p => ({ ...p, projected_pct_at_reset: null, burn_pct_per_h: null }))
const body = (cols: number, rows: number, c: unknown, view?: { focus: number; expanded: boolean }) => renderQuota(ctxOf(cols, rows, c), view).body.map(text)

const GOLDEN = {
  wide: [
      "── 額度池（預測由 fleet 算，面板不重算；近 6 時） ───────────────────────────────────────────────────────────────────────────────────────────────── 資料 40 秒前",
      "    池                     7 天      5 時  重置（台北）         近 6 時     預測  用完時間      席數   判定",
      "‣ ✗ trinity                 31%✗       0%✗ 11-20 週五 06:00    +0.3%/時✗     47%✗ —             1 席   ✗ 180 分未更新",
      "  ✗ twgame                  49%        0%  11-19 週四 09:00    +1.4%/時      94%  —             2 席   ✗ 席過期 14 分",
      "  ? team                    68%       17%  11-21 週六 12:00    +1.9%/時    >100%  11-18 18:00   3 席   未知·17時用完",
      "  ? personal               100%      100%  11-19 週四 08:00    +1.1%/時     100%  已用完        5 席   未知·缺換池",
      "  ⏶ grok                    10%        0%  11-24 週二 00:00    +0.0%/時      10%  —             1 席   浪費 90%",
      "  ⏶ lab                     22%        4%  11-22 週日 10:00    +0.2%/時      43%  —             2 席   浪費 57%",
      "  ✓ codex                   80%       12%  11-19 週四 21:00    +0.4%/時      98%  —             2 席   會用到 98%",
      "",
      "── 焦點池 trinity ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
      "席    共 1 席（席位清單沒有明細）",
      "換池  沒有換池資料（capacity 尚未提供）",
      "判定  紅：180 分未更新（>10 分；statusline 沒在跑）",
      "排序  紅：已用完 > 最早用完 > 過期（最舊在前）；黃：浪費比例多的在前；最後才是綠"
  ],
  mid: [
      "── 額度池 · 預測由 fleet 算 · 近 6 時 ───────────────────────────────────────────────────────────────────── 資料 40 秒前",
      "    池              7 天      5 時  重置（台北）    近 6 時     預測  判定",
      "‣ ✗ trinity          31%✗       0%✗ 週五 06:00     +0.3%/時✗     47%✗ ✗ 180 分未更新",
      "  ✗ twgame           49%        0%  週四 09:00     +1.4%/時      94%  ✗ 席過期 14 分",
      "  ? team             68%       17%  週六 12:00     +1.9%/時    >100%  未知·17時用完",
      "  ? personal        100%      100%  週四 08:00     +1.1%/時     100%  未知·缺換池",
      "  ⏶ grok             10%        0%  週二 00:00     +0.0%/時      10%  浪費 90%",
      "  ⏶ lab              22%        4%  週日 10:00     +0.2%/時      43%  浪費 57%",
      "  ✓ codex            80%       12%  週四 21:00     +0.4%/時      98%  會用到 98%",
      "",
      "── 焦點池 trinity ──────────────────────────────────────────────────────────────────────────────────────────────────────",
      "席    共 1 席（席位清單沒有明細）",
      "換池  沒有換池資料（capacity 尚未提供）",
      "判定  紅：180 分未更新（>10 分；statusline 沒在跑）"
  ],
  narrow: [
      "── 額度池 · 預測由 fleet 算 · 近 6 時 ───────────────────────────── 資料 40 秒前",
      "    池         7 天  5 時  重置    近 6 時    預測  判定",
      "‣ ✗ trinity     31%✗   0%✗ 週五06 +0.3%/時✗    47%✗ ✗ 180 分未更新",
      "  ✗ twgame      49%    0%  週四09 +1.4%/時     94%  ✗ 席過期 14 分",
      "  ? team        68%   17%  週六12 +1.9%/時   >100%  未知·17時用完",
      "  ? personal   100%  100%  週四08 +1.1%/時    100%  未知·缺換池",
      "  ⏶ grok        10%    0%  週二00 +0.0%/時     10%  浪費 90%",
      "  ⏶ lab         22%    4%  週日10 +0.2%/時     43%  浪費 57%",
      "  ✓ codex       80%   12%  週四21 +0.4%/時     98%  會用到 98%",
      "",
      "── 焦點 trinity ────────────────────────────────────────────────────────────────",
      "席    共 1 席（席位清單沒有明細）",
      "判定  紅：180 分未更新（>10 分；statusline 沒在跑）"
  ], // R4-2: headed rows use fixed numeric columns, without repeated labels.
  nopaceNarrow: [
      "── 額度池 · ? 無來源：用量預測未接通 ────────────────────────────── 資料 40 秒前",
      "    池         7 天  5 時  重置   速率 · 預測 · 判定",
      "‣ ✗ trinity     31%✗   0%✗ 週五06 ✗ 180 分未更新",
      "  ✗ twgame      49%    0%  週四09 ✗ 席過期 14 分",
      "  ✗ codex       80%   12%  週四21 ? 無預測來源",
      "  ✗ team        68%   17%  週六12 ? 無預測來源",
      "  ✗ lab         22%    4%  週日10 ? 無預測來源",
      "  ✗ grok        10%    0%  週二00 ? 無預測來源",
      "  ? personal   100%  100%  週四08 未知·缺換池",
      "",
      "── 焦點 trinity ────────────────────────────────────────────────────────────────",
      "席    共 1 席（席位清單沒有明細）",
      "判定  紅：180 分未更新（>10 分；statusline 沒在跑）"
  ], // R4-2: headed rows use fixed numeric columns, without repeated labels.
  nopaceWide: [
    "── 額度池 · ? 無來源：用量預測未接通 ────────────────────────────────────────────────────────────────────────────────────────────────────────────── 資料 40 秒前",
    "(逐席列出，依額度池分組；池取席內最大值)",
    "    池                     7 天      5 時  重置（台北）      速率 · 預測 · 判定",
    "‣ ✗ trinity                 31%✗       0%✗ 11-20 週五 06:00  ✗ 180 分未更新",
    "  ✗ twgame                  49%        0%  11-19 週四 09:00  ✗ 席過期 14 分",
    "  ✗ codex                   80%       12%  11-19 週四 21:00  ? 無預測來源",
    "  ✗ team                    68%       17%  11-21 週六 12:00  ? 無預測來源",
    "  ✗ lab                     22%        4%  11-22 週日 10:00  ? 無預測來源",
    "  ✗ grok                    10%        0%  11-24 週二 00:00  ? 無預測來源",
    "  ? personal               100%      100%  11-19 週四 08:00  未知·缺換池",
    "",
    "── 焦點池 trinity ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
    "席    共 1 席（席位清單沒有明細）",
    "換池  沒有換池資料（capacity 尚未提供）",
    "判定  紅：180 分未更新（>10 分；statusline 沒在跑）",
    "排序  已用完 > 過期（最舊在前）> 7 天最高",
  ],
  expanded: [
      "── 額度池（預測由 fleet 算，面板不重算；近 6 時） ───────────────────────────────────────────────────────────────────────────────────────────────── 資料 40 秒前",
      "    池                     7 天      5 時  重置（台北）         近 6 時     預測  用完時間      席數   判定",
      "‣ ✗ trinity                 31%✗       0%✗ 11-20 週五 06:00    +0.3%/時✗     47%✗ —             1 席   ✗ 180 分未更新",
      "  ✗ twgame                  49%        0%  11-19 週四 09:00    +1.4%/時      94%  —             2 席   ✗ 席過期 14 分",
      "  ? team                    68%       17%  11-21 週六 12:00    +1.9%/時    >100%  11-18 18:00   3 席   未知·17時用完",
      "  ? personal               100%      100%  11-19 週四 08:00    +1.1%/時     100%  已用完        5 席   未知·缺換池",
      "  ⏶ grok                    10%        0%  11-24 週二 00:00    +0.0%/時      10%  —             1 席   浪費 90%",
      "  ⏶ lab                     22%        4%  11-22 週日 10:00    +0.2%/時      43%  —             2 席   浪費 57%",
      "  ✓ codex                   80%       12%  11-19 週四 21:00    +0.4%/時      98%  —             2 席   會用到 98%",
      "",
      "── 焦點池 trinity ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
      "席    共 1 席（席位清單沒有明細）",
      "換池  沒有換池資料（capacity 尚未提供）",
      "判定  紅：180 分未更新（>10 分；statusline 沒在跑）",
      "排序  紅：已用完 > 最早用完 > 過期（最舊在前）；黃：浪費比例多的在前；最後才是綠"
  ],
}

test('quota: 160x40 pace (the mockup): one row per pool in danger order, verdict text per A7, no arrows', () => {
  expect(body(160, 40, consoleOf(POOLS, { seats: SEATS }))).toEqual(GOLDEN.wide)
  expect(GOLDEN.wide.join('')).not.toContain('↑')
})
test('quota: 120x30 pace (the mockup)', () => { expect(body(120, 30, consoleOf(POOLS, { seats: SEATS }))).toEqual(GOLDEN.mid) })
test('quota: 80x24 pace: one row per pool, all six columns abbreviated, the stale reasons whole under the table (A10), the full verdict in the focus detail', () => {
  expect(body(80, 24, consoleOf(POOLS, { seats: SEATS }))).toEqual(GOLDEN.narrow)
})
test('quota: no pace (sources.quota_forecast no_source): rate, projection, verdict read "無來源：capacity pace 未接", except limit_hit and a stale pool', () => {
  expect(body(80, 24, consoleOf(NOPACE, { pace: false, seats: SEATS }))).toEqual(GOLDEN.nopaceNarrow)
  expect(body(160, 40, consoleOf(NOPACE, { pace: false, seats: SEATS }))).toEqual(GOLDEN.nopaceWide)
})
test('quota: Enter (A3) expands the focused pool\'s seats from the seats feed; a stale seat carries the mark', () => {
  expect(body(160, 40, consoleOf(POOLS, { seats: SEATS }), { focus: 0, expanded: true })).toEqual(GOLDEN.expanded)
})

test('quota: frameRows is exactly H rows in every size and state, actions <= A, strip last', () => {
  const states: [string, unknown][] = [
    ['pace', consoleOf(POOLS, { seats: SEATS })], ['no pace', consoleOf(NOPACE, { pace: false })], ['no console', null], ['no quota object', consoleOf(null)],
    ['no pools', consoleOf([])], ['one pool', consoleOf([POOLS[0]])],
    ['suggestion', consoleOf(POOLS.map(p => ({ ...p, switch_suggestion: 'personal -> team' })))],
  ]
  const bad: string[] = []
  for (const [cols, rows] of SIZES)
    for (const [name, c] of states) {
      const ctx = ctxOf(cols, rows, c)
      const out = frameRows(page, ctx)
      if (out.length !== rows) bad.push(`${cols}x${rows}/${name}=${out.length}`)
      if ((page as { render: (x: never) => { actions: unknown[] } }).render(ctx).actions.length > A(rows)) bad.push(`${cols}x${rows}/${name} actions`)
      if (!/1\D*2\D*3\D*4/.test(text(out[out.length - 1]))) bad.push(`${cols}x${rows}/${name} strip`)
    }
  expect(bad.join(' ')).toBe('')
})
test('quota: 30 pools still frame to H rows (the body scrolls, the page never grows the pane)', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...POOLS[i % POOLS.length], pool: 'p' + i }))
  for (const [cols, rows] of SIZES) expect(frameRows(page, ctxOf(cols, rows, consoleOf(many))).length).toBe(rows)
})

test('quota: no console / no quota / no pools draw the section 5 "no source" row in the broken colour, and never throw', () => {
  for (const c of [null, consoleOf(null), consoleOf([])]) {
    const { body: b, actions } = renderQuota(ctxOf(120, 30, c))
    expect(b.length).toBe(1)
    expect(text(b[0])).toMatch(/無來源/)
    expect(b[0][0].color).toBe(PALETTE.broken)
    expect(actions.length).toBe(0)
  }
  expect(() => renderQuota({ ...(ctxOf(80, 24, consoleOf(POOLS))) as object, live: null } as never)).not.toThrow()
  // a wrong-typed pool in an untrusted feed is dropped, the rest still draws
  const dirty = consoleOf([...POOLS, { pool: 7 }, null, 'x', { pool: 'bad', seven_day_pct: '12' }])
  expect(body(160, 40, dirty).filter(l => l.includes('bad'))[0]).toContain('—')
})
test('quota: null stays null: an empty pool draws dashes, never 0%, and ranks below a pool with a number', () => {
  const only = body(160, 40, consoleOf([{ pool: 'blank' }, { pool: 'lab', seven_day_pct: 22, projected_pct_at_reset: 43, resets_at_ms: POOLS[2].resets_at_ms }]))
  const blank = only.find(l => l.includes('blank')) as string
  expect(blank).not.toMatch(/\b0%/)
  expect(blank).toContain('—')
})

test('quota: red / yellow / green rows use the PALETTE roles on the glyph and the verdict; no background, no inverse, bold only never', () => {
  const rows = renderQuota(ctxOf(160, 40, consoleOf(POOLS))).body
  const row = (name: string) => rows.find(r => r.some(s => s.text.includes(name))) as never as { text: string; color?: string; background?: unknown; inverse?: unknown; bold?: unknown }[]
  const last = (r: { color?: string }[]) => r[r.length - 1].color
  expect(last(row('trinity'))).toBe(PALETTE.broken)
  expect(last(row('personal'))).toBe(PALETTE.attention) // unknown (no switch data) is warning level, option B
  expect(last(row('grok'))).toBe(PALETTE.attention)
  expect(last(row('codex'))).toBe(PALETTE.done)
  expect(row('trinity').find(s => s.text.includes('31%'))?.color).toBe(PALETTE.broken) // the stale number carries the red mark
  for (const r of rows) for (const s of r) { expect(s.background).toBeUndefined(); expect(s.inverse).toBeUndefined(); expect(s.bold).toBeUndefined() }
})

test('quota: the action area holds only the [f] switch advice, and only when capacity gave one for the focused pool', () => {
  const none = renderQuota(ctxOf(160, 40, consoleOf(POOLS)))
  expect(none.actions.length).toBe(1)
  expect(text(none.actions[0])).toBe('[o] 展開各席 · 上一池 · 下一池 (1/7)')
  const withAdvice = consoleOf(POOLS.map(p => (p.pool === 'trinity' ? { ...p, switch_suggestion: 'trinity -> team' } : p)))
  const a = renderQuota(ctxOf(160, 40, withAdvice)).actions
  expect(a.length).toBe(1)
  expect(text(a[0])).toBe('[o] 展開各席 · 上一池 · 下一池 (1/7) · [f] 換池')
  // focus on a pool with no advice: no action
  expect(renderQuota(ctxOf(160, 40, withAdvice), { focus: 1, expanded: false }).actions.flat().some(s => s.press?.startsWith('fill:'))).toBe(false)
})

test('quota: the page row order and the band pick agree (rank 0 = worstPool), and a pool past 10 minutes is stale without the feed flag', () => {
  const w = worstPool(POOLS as never, NOW) as { pool: string }
  expect(body(160, 40, consoleOf(POOLS)).find(l => l.startsWith('‣'))).toContain(w.pool)
  const aged = POOLS.map(p => (p.pool === 'codex' ? { ...p, observed_at_ms: NOW - 12 * MIN } : p))
  const line = body(160, 40, consoleOf(aged)).find(l => l.includes('codex')) as string
  expect(line).toContain('12 分未更新')
  expect(line).toContain('✗')
})
test('quota: a stale pool with unknown age uses plain full and short verdicts', () => {
  const p = { ...POOLS.find(p => p.pool === 'trinity')!, stale: true, stale_age_min: null, observed_at_ms: null }
  const ctx = ctxOf(160, 40, consoleOf([p])) as Parameters<typeof renderQuota>[0]
  const v = classify(normalizedPools(ctx.console)![0], NOW, true, ctx.t)
  expect(v.kind).toBe('stale')
  expect(v.staleMin).toBeNull()
  const row = renderQuota(ctx).body.find(r => text(r).startsWith('‣'))!
  for (const verdict of [v.text, text(row)]) {
    expect(verdict).toContain('年紀不明')
    expect(verdict).not.toMatch(/[-—]\s*分/)
  }
  expect(v.text).toContain('statusline 沒在跑')
})

test('quota: the registry carries the framed quota page at key 5 (folded into spend, reached through EXTRA_PAGES)', () => {
  expect((page as { framed?: boolean }).framed).toBe(true)
  expect((page as { key: string }).key).toBe('5')
})

test('quota: no body row of the pool table is wider than the pane (every long reason is wrapped by the frame, never cut)', () => {
  const wide: string[] = []
  for (const [cols, rows] of SIZES)
    for (const c of [consoleOf(POOLS, { seats: SEATS }), consoleOf(NOPACE, { pace: false, seats: SEATS })])
      for (const l of frameRows(page, ctxOf(cols, rows, c)).map(text)) if (displayWidth(l) > cols) wide.push(cols + ': ' + l)
  expect(wide.join('\n')).toBe('')
})

test('quota: compact mode (80x7, shortBody) suppresses only headings and column header, then uses remaining body rows for full verdict (wrapped, never truncated) and seats while pool rows keep priority', () => {
  const trinity = POOLS.find(p => p.pool === 'trinity')!
  const personal = POOLS.find(p => p.pool === 'personal')!
  const codex = POOLS.find(p => p.pool === 'codex')!
  const grok = POOLS.find(p => p.pool === 'grok')!

  // 80 columns, H=7, one pool whose full verdict is longer than the short one, no explicit actions
  const out = frameRows(page, ctxOf(80, 8, consoleOf([trinity], { cards: [] }))).map(text)
  expect(out.length).toBe(8)
  const compactBody = out.slice(1, 5).filter(l => l.trim() !== '')
  expect(compactBody.some(l => l.includes('──'))).toBe(false)
  expect(compactBody.some(l => l.includes('重置') || l.includes('7 天'))).toBe(false)
  expect(compactBody[0]).toContain('7天 31%✗ · 5時 0%✗ · 預 47%✗')
  expect(compactBody[0]).not.toContain('statusline 沒在跑')
  expect(compactBody[1]).toBe('trinity 判定紅：180 分未更新（>10 分；statusline 沒在跑）')
  expect(compactBody[2]).toBe('席    共 1 席（席位清單沒有明細）')
  expect(out[5]).toBe('[o] 展開各席 · 上一池 · 下一池 (1/1)')

  // Long full verdict (> 80 cols) wraps across remaining body rows and is never truncated
  const longNote = 'statusline 沒在跑，而且本席上一次回報已經超過三小時，必須把完整原因換行顯示出來不能截斷'
  const wrappedOut = frameRows(page, ctxOf(80, 8, consoleOf([{ ...trinity, stale_note: longNote }], { cards: [] }))).map(text)
  expect(wrappedOut.every(l => displayWidth(l) <= 80)).toBe(true)
  const wrappedBody = wrappedOut.slice(1, 5)
  expect(wrappedBody.join('').replace(/\s+/g, '')).toContain(('判定紅：180分未更新（>10分；' + longNote + '）').replace(/\s+/g, ''))
  expect(wrappedBody.some(l => l.includes('…'))).toBe(false)
  expect(wrappedBody[3]).toBe('席    共 1 席（席位清單沒有明細）')

  // Expanded seats follow the full verdict only while they fit in the remaining body rows
  const openPage = { ...quotaPage, render: (c: Parameters<typeof renderQuota>[0]) => renderQuota(c, { focus: 0, expanded: true }) }
  const openBody = frameRows(openPage, ctxOf(80, 8, consoleOf([personal], { seats: SEATS, cards: [] }))).map(text).slice(1, 5)
  expect(openBody[0]).toContain('personal')
  expect(openBody[1]).toBe('personal 判定黃：已達額度上限，判定未知：缺換池資料（capacity）')
  expect(openBody[2]).toBe('席    capacity--claude  7 天 100%  5 時 100%  0 分前')
  expect(openBody[3]).toBe('      hangar--claude  7 天 100%  5 時 100%  1 分前')
  const scrolledBody = frameRows(openPage, ctxOf(80, 8, consoleOf([personal], { seats: SEATS, cards: [] })), { scroll: 1 }).map(text).slice(1, 5)
  expect(scrolledBody).toEqual(openBody)
  const staleSeatBody = frameRows(openPage, ctxOf(80, 8, consoleOf([personal], { seats: SEATS.slice(1), cards: [] }))).map(text).slice(1, 5)
  expect(staleSeatBody[3]).toBe('      old--claude  7 天 97%✗  5 時 90%✗  14 分前')

  // R5: Focused pool's full verdict is reserved FIRST, then remaining rows go to other pools in danger order
  const threeBody = frameRows(page, ctxOf(80, 8, consoleOf([codex, personal, trinity], { cards: [] }))).map(text).slice(1, 5)
  expect(threeBody[0]).toContain('trinity')
  expect(threeBody[1]).toContain('personal')
  expect(threeBody[2]).toContain('codex')
  expect(threeBody[3]).toBe('trinity 判定紅：180 分未更新（>10 分；statusline 沒在跑）')

  const fourBody = frameRows(page, ctxOf(80, 8, consoleOf([codex, grok, personal, trinity], { cards: [] }))).map(text).slice(1, 5)
  expect(fourBody[0]).toContain('trinity')
  expect(fourBody[1]).toContain('personal')
  // M2 (codeforge B49-B54, S1-full-p4-80x24 row 15): a cut 80-column table says what it hides instead of silently dropping grok and codex
  expect(fourBody[2]).toBe('↓ 還有 2 池（⏶1 ✓1）')
  expect(fourBody[3]).toBe('trinity 判定紅：180 分未更新（>10 分；statusline 沒在跑）')
})

test('quota R4 & R10: unknown pools use ? icon and 未知· prefix with warning colour role; rate column has %/時 unit and time headers use 7 天 / 5 時 everywhere', () => {
  const rows = renderQuota(ctxOf(80, 24, consoleOf(POOLS))).body
  const teamRow = rows.find(r => text(r).includes('team'))!
  const personalRow = rows.find(r => text(r).includes('personal'))!
  const grokRow = rows.find(r => text(r).includes('grok'))!
  expect(teamRow[1].text).toBe('? ')
  expect(teamRow[1].color).toBe(PALETTE.attention)
  expect(text(teamRow)).toContain('未知·17時用完')
  expect(personalRow[1].text).toBe('? ')
  expect(personalRow[1].color).toBe(PALETTE.attention)
  expect(text(personalRow)).toContain('未知·缺換池')
  expect(grokRow[1].text).toBe('⏶ ')
  expect(grokRow[1].color).toBe(PALETTE.attention)
  for (const [cols, h] of SIZES) {
    const b = body(cols, h, consoleOf(POOLS, { seats: SEATS }))
    expect(b[1]).toContain('7 天')
    expect(b[1]).toContain('5 時')
    expect(b[1]).not.toContain('5 小時')
    expect(b[2]).toContain('%/時') // V1: labels fit without dropping the existing rate.
  }
})

test('quota R1: a blocked seat without facts.seat uses its id, retaining stale source without repeating the pool verdict', () => {
  const blocked = {
    id: 'seat_blocked:s1', kind: 'seat_blocked', severity: 1, state: 'failed', needs_operator: true,
    title: 's1：F 池額度用完', text: 's1 額度用完：F 池 7 天用盡', since_ms: NOW - 5 * MIN,
    line_id: null, to_console: true, answerable_by: [], facts: { pool: 'pool-f', stale: true, source: 'statusline' },
  }
  const c = consoleOf([{ ...POOLS[3], pool: 'pool-f' }], { cards: [], items: [blocked] })
  for (const [cols, rows] of SIZES) {
    const out = frameRows(quotaPage, ctxOf(cols, rows, c)).map(text)
    const verdicts = out.filter(l => !l.startsWith('── 焦點') && !l.startsWith('F 池 判定') && l.includes('F 池'))
    expect(verdicts.length).toBe(1)
    const seat = out.find(l => l.startsWith('用完'))!
    expect(seat).toContain('s1')
    expect(seat).toContain('✗')
    expect(seat).toContain('資料過期：statusline 沒在跑')
    expect(seat).not.toContain('F 池')
  }
})

test('quota R5: at 120x30 and 80x24 with many pools and a multi-row wrapped verdict, focused pool full reason is kept whole and never cut by ↓ 還有 N 列', () => {
  const longReason = 'statusline 沒在跑，而且多個席位已超過三小時未上報最新配額數據，完整原因必須換行保留不可被還有幾列截斷'
  const many = Array.from({ length: 22 }, (_, i) => ({
    ...POOLS[i % POOLS.length],
    pool: 'pool-' + String.fromCharCode(97 + (i % 22)),
    ...(i === 0 ? { stale: true, stale_age_min: 240, stale_note: longReason } : { stale: false, stale_note: null, limit_hit: false }),
  }))
  for (const [cols, rows] of [[120, 30], [80, 24]] as const) {
    const out = frameRows(page, ctxOf(cols, rows, consoleOf(many, { cards: [] }))).map(text)
    expect(out.length).toBe(rows)
    expect(out.some(l => l.includes('還有'))).toBe(true)
    const joined = out.join('').replace(/\s+/g, '')
    expect(joined).toContain(longReason.replace(/\s+/g, ''))
    expect(out.filter(l => !l.includes('還有')).some(l => l.includes('…'))).toBe(false)
    // Verify even when focus is on a lower-ranked pool (focus: 15)
    const focus15Page = { ...quotaPage, render: (c: Parameters<typeof renderQuota>[0]) => renderQuota(c, { focus: 15, expanded: false }) }
    // Focus is a rank in danger order, not the source-array index. Put fifteen
    // more wasteful pools before the target and calmer pools after it.
    const many15 = many.map((p, idx) => ({
      ...POOLS[1], pool: idx === 15 ? 'deepfocus' : p.pool,
      projected_pct_at_reset: idx < 15 ? 10 : idx === 15 ? 25 : 98,
    }))
    const deepSnap = consoleOf(many15, { cards: [] }) as Parameters<typeof normalizedPools>[0]
    expect(rankPools(normalizedPools(deepSnap)!, NOW)[15].pool).toBe('deepfocus')
    const out15 = frameRows(focus15Page, ctxOf(cols, rows, deepSnap)).map(text)
    expect(out15.join('\n')).toContain('deepfocus')
    expect(out15.join('\n')).toContain('判定  黃：約剩 75% 會浪費')
  }
})

test('quota shortBody & poolRoom: focused verdict is never cut and renderQuota wrapped rows stay <= room across 80x7 (3 pools + 1-row warning/unknown, 2 pools + 2-row wrapped) and 80x5 (1 pool + 1-row)', () => {
  const trinity = POOLS.find(p => p.pool === 'trinity')!
  const personal = POOLS.find(p => p.pool === 'personal')!
  const grok = POOLS.find(p => p.pool === 'grok')!
  const lab = POOLS.find(p => p.pool === 'lab')!
  const codex = POOLS.find(p => p.pool === 'codex')!
  const longNote = 'statusline 沒在跑，而且本席上一次回報已經超過三小時，必須把完整原因換行顯示出來不能截斷'

  const cases: { name: string; cols: number; rows: number; room: number; pools: unknown[]; wantVerdict: string }[] = [
    {
      name: '80x7 3 pools + 1-row unknown verdict',
      cols: 80, rows: 8, room: 4,
      pools: [personal, grok, codex],
      wantVerdict: 'personal 判定黃：已達額度上限，判定未知：缺換池資料（capacity）',
    },
    {
      name: '80x7 3 pools + 1-row warning verdict',
      cols: 80, rows: 8, room: 4,
      pools: [grok, lab, codex],
      wantVerdict: 'grok 判定黃：約剩 90% 會浪費',
    },
    {
      name: '80x7 2 pools + 2-row wrapped verdict',
      cols: 80, rows: 8, room: 4,
      pools: [{ ...trinity, stale_note: longNote }, codex],
      wantVerdict: 'trinity 判定紅：180 分未更新（>10 分；' + longNote + '）',
    },
    {
      name: '80x5 1 pool + 1-row verdict',
      cols: 80, rows: 6, room: 2,
      pools: [trinity],
      wantVerdict: 'trinity 判定紅：180 分未更新（>10 分；statusline 沒在跑）',
    },
    {
      name: '80x5 2 pools + 2-row wrapped verdict (room - vLen === 0)',
      cols: 80, rows: 6, room: 2,
      pools: [{ ...trinity, stale_note: longNote }, codex],
      wantVerdict: 'trinity 判定紅：180 分未更新（>10 分；' + longNote + '）',
    },
  ]

  for (const tc of cases) {
    const baseCtx = ctxOf(tc.cols, tc.rows, consoleOf(tc.pools, { seats: SEATS, cards: [] }))
    const shortCtx = { ...(baseCtx as object), shortBody: true } as Parameters<typeof renderQuota>[0]
    const rendered = renderQuota(shortCtx)
    expect(rowsWrappedLen(rendered.body, tc.cols), tc.name + ' wrapped len <= room').toBeLessThanOrEqual(tc.room)
    expect(rendered.body.map(text).join('').replace(/\s+/g, ''), tc.name + ' renderQuota full verdict').toContain(tc.wantVerdict.replace(/\s+/g, ''))

    const framed = frameRows(page, baseCtx).map(text)
    expect(framed.length, tc.name + ' frame height').toBe(tc.rows)
    const framedBody = framed.slice(1, 1 + tc.room)
    expect(framedBody.some(l => l.includes('還有')), tc.name + ' no more hint').toBe(false)
    expect(framedBody.join('').replace(/\s+/g, ''), tc.name + ' framed full verdict').toContain(tc.wantVerdict.replace(/\s+/g, ''))
  }

  // room <= 0 fallback keeps the focused pool row plus its verdict
  const zeroRoom = renderQuota({ ...(ctxOf(80, 2, consoleOf([personal, codex], { cards: [] })) as object), shortBody: true } as Parameters<typeof renderQuota>[0])
  expect(text(zeroRoom.body[0])).toContain('personal')
  expect(zeroRoom.body.map(text).join('\n')).toContain('personal 判定黃：已達額度上限，判定未知：缺換池資料（capacity）')

  // poolRoom clamped with Math.max(0, ...) when room > 4 (80x9 -> room 5) and a 5-row wrapped verdict fills room
  const fiveRowNote = '甲'.repeat(160)
  const ctx8 = ctxOf(80, 9, consoleOf([{ ...trinity, stale_note: fiveRowNote }, codex], { cards: [] }))
  const r8 = renderQuota(ctx8)
  expect(rowsWrappedLen(r8.body, 80)).toBe(5)
  const f8 = frameRows(page, ctx8).map(text)
  expect(f8.some(l => l.includes('還有'))).toBe(false)
  expect(f8.slice(1, 6).join('').replace(/\s+/g, '')).toContain(('判定紅：180分未更新（>10分；' + fiveRowNote + '）').replace(/\s+/g, ''))
})
