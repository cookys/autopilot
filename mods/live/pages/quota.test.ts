// quota.test.ts — the 額度 page (plan r2 §4.1, g2 A1 / A3 / A7 / A10 / A11): golden rows of the mockup states, exactly H rows through frameRows at 160x40 / 120x30 / 80x24,
// the no-source rows, null staying null, the action area, the red markers (theme keys through PALETTE only, no background, no inverse).
// The goldens are the 額度 drawings of s0b/mockups.md row for row, with these known differences: the mockup's first line (seat, ages, branch) is the frame's header row, not the body;
// the frame bottom-anchors the body (blank rows ABOVE it) where the drawing top-anchors it; the failed glyph is GLYPHS.state.failed (✗), because ✖ is an emoji-risk glyph (EMOJI_BANNED).
import { test, expect } from 'claude-code/testing'
import { frameRows } from './frame'
import { PAGES } from './index'
import { PALETTE, displayWidth } from '../ui'
import { renderQuota } from './quota'
import { worstPool } from './quota-pick'
import { NOW, POOLS, SEATS, MIN, consoleOf, ctxOf } from './quota.fixture'

const text = (row: { text: string }[]) => row.map(s => s.text).join('').trimEnd()
const page = PAGES.find(p => p.id === 'quota') as never
const A = (rows: number) => (rows >= 32 ? 6 : 4)
const SIZES = [[160, 40], [120, 30], [80, 24]] as const
const NOPACE = POOLS.map(p => ({ ...p, projected_pct_at_reset: null, burn_pct_per_h: null }))
const body = (cols: number, rows: number, c: unknown, view?: { focus: number; expanded: boolean }) => renderQuota(ctxOf(cols, rows, c), view).body.map(text)

const GOLDEN = {
  wide: [
    "── 額度池（預測 = fleet 算，pane 不重算；近 6 時 = burn_window_h 6） ────────────────────────────────────────────────────────────────────────────── 資料 40 秒前",
    "    池                  7 天    5 小時   重置（台北）      近 6 時   預測    用完時間      席數   判定",
    "▸ ✗ personal            100%    100%     11-19 週四 08:00  +1.1/h    100%    已用完        5 席   已用完，換池資料無來源",
    "  ✗ team                68%     17%      11-21 週六 12:00  +1.9/h    >100%   11-18 18:00   3 席   約 17 時後用完，換池資料無來源",
    "  ✗ trinity             31%✗    0%✗      11-20 週五 06:00  +0.3/h✗   47%✗    —             1 席   ✗ 180 分未更新（>10 分；statusline 沒在跑）",
    "  ✗ twgame              49%     0%       11-19 週四 09:00  +1.4/h    94%     —             2 席   ✗ 席 twgame-2 過期 14 分，舊值 55% 較高",
    "  ▲ grok                10%     0%       11-24 週二 00:00  +0.0/h    10%     —             1 席   約剩 90% 會浪費",
    "  ▲ lab                 22%     4%       11-22 週日 10:00  +0.2/h    43%     —             2 席   約剩 57% 會浪費",
    "  ✓ codex               80%     12%      11-19 週四 21:00  +0.4/h    98%     —             2 席   會用到 98%",
    "",
    "── 焦點池 personal（Enter 展開各席） ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
    "席    capacity--claude · hangar--claude · … 共 5 席",
    "換池  stranded_seats、switched 都是 null（capacity r5 之前沒有來源）",
    "判定  紅：limit_hit 為真，已用完，換池資料無來源",
    "排序  紅：已用完 > 最早用完 > 過期（最舊在前）；黃：浪費比例多的在前；最後才是綠",
  ],
  mid: [
    "── 額度池 · 預測 fleet 算 · 近 6 時 = burn_window_h 6 ───────────────────────────────────────────────────── 資料 40 秒前",
    "    池            7 天   5 小時   重置（台北）  近 6 時  預測    判定",
    "▸ ✗ personal      100%   100%     週四 08:00    +1.1/h   100%    已用完，換池資料無來源",
    "  ✗ team          68%    17%      週六 12:00    +1.9/h   >100%   約 17 時後用完，換池資料無來源",
    "  ✗ trinity       31%✗   0%✗      週五 06:00    +0.3/h✗  47%✗    ✗ 180 分未更新（>10 分；statusline 沒在跑）",
    "  ✗ twgame        49%    0%       週四 09:00    +1.4/h   94%     ✗ 席 twgame-2 過期 14 分，舊值 55% 較高",
    "  ▲ grok          10%    0%       週二 00:00    +0.0/h   10%     約剩 90% 會浪費",
    "  ▲ lab           22%    4%       週日 10:00    +0.2/h   43%     約剩 57% 會浪費",
    "  ✓ codex         80%    12%      週四 21:00    +0.4/h   98%     會用到 98%",
    "",
    "── 焦點池 personal（Enter 展開各席） ───────────────────────────────────────────────────────────────────────────────────",
    "席    capacity--claude · hangar--claude · … 共 5 席",
    "換池  stranded_seats、switched 都是 null（capacity r5 之前沒有來源）",
    "判定  紅：limit_hit 為真，已用完，換池資料無來源",
  ],
  narrow: [
    "── 額度池 · 預測 fleet 算 · 近 6 時 = burn_window_h 6 ───────────── 資料 40 秒前",
    "    池        7d    5h   重置   近 6 時 預測  判定",
    "▸ ✗ personal  100%  100% 週四08 +1.1    100%  紅 已用完，換池資料無來源",
    "  ✗ team      68%   17%  週六12 +1.9    >100% 紅 約 17 時後用完，換池資料無來源",
    "  ✗ trinity   31%✗  0%✗  週五06 +0.3✗   47%✗  紅 ✗ 見下",
    "  ✗ twgame    49%   0%   週四09 +1.4    94%   紅 ✗ 見下",
    "  ▲ grok      10%   0%   週二00 +0.0    10%   黃 約剩 90% 會浪費",
    "  ▲ lab       22%   4%   週日10 +0.2    43%   黃 約剩 57% 會浪費",
    "  ✓ codex     80%   12%  週四21 +0.4    98%   綠 會用到 98%",
    "✗ trinity 180 分未更新（>10 分；statusline 沒在跑）",
    "✗ twgame 席 twgame-2 過期 14 分，舊值 55% 較高",
    "",
    "── 焦點 personal（Enter 展開各席） ─────────────────────────────────────────────",
    "席    capacity--claude · hangar--claude · … 共 5 席",
    "判定  紅：limit_hit 為真，已用完，換池資料無來源",
  ],
  nopaceNarrow: [
    "── 額度池 · ✗ 無來源：capacity pace 未接 ────────────────────────── 資料 40 秒前",
    "    池        7d    5h   重置   速率 · 預測 · 判定",
    "▸ ✗ personal  100%  100% 週四08 紅 已用完，換池資料無來源",
    "  ✗ trinity   31%✗  0%✗  週五06 紅 ✗ 見下",
    "  ✗ twgame    49%   0%   週四09 紅 ✗ 見下",
    "  ✗ codex     80%   12%  週四21 ✗ 無來源：capacity pace 未接",
    "  ✗ team      68%   17%  週六12 ✗ 無來源：capacity pace 未接",
    "  ✗ lab       22%   4%   週日10 ✗ 無來源：capacity pace 未接",
    "  ✗ grok      10%   0%   週二00 ✗ 無來源：capacity pace 未接",
    "✗ trinity 180 分未更新（>10 分；statusline 沒在跑）",
    "✗ twgame 席 twgame-2 過期 14 分，舊值 55% 較高",
    "",
    "── 焦點 personal（Enter 展開各席） ─────────────────────────────────────────────",
    "席    capacity--claude · hangar--claude · … 共 5 席",
    "判定  紅：limit_hit 為真，已用完，換池資料無來源",
  ],
  nopaceWide: [
    "── 額度池 · ✗ 無來源：capacity pace 未接 ────────────────────────────────────────────────────────────────────────────────────────────────────────── 資料 40 秒前",
    "(seats --quota 逐席列，依 pool_key 分池；池取席內最大值)",
    "    池                  7 天    5 小時   重置（台北）      速率 · 預測 · 判定",
    "▸ ✗ personal            100%    100%     11-19 週四 08:00  已用完，換池資料無來源",
    "  ✗ trinity             31%✗    0%✗      11-20 週五 06:00  ✗ 180 分未更新（>10 分；statusline 沒在跑）",
    "  ✗ twgame              49%     0%       11-19 週四 09:00  ✗ 席 twgame-2 過期 14 分，舊值 55% 較高",
    "  ✗ codex               80%     12%      11-19 週四 21:00  ✗ 無來源：capacity pace 未接",
    "  ✗ team                68%     17%      11-21 週六 12:00  ✗ 無來源：capacity pace 未接",
    "  ✗ lab                 22%     4%       11-22 週日 10:00  ✗ 無來源：capacity pace 未接",
    "  ✗ grok                10%     0%       11-24 週二 00:00  ✗ 無來源：capacity pace 未接",
    "",
    "── 焦點池 personal（Enter 展開各席） ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
    "席    capacity--claude · hangar--claude · … 共 5 席",
    "換池  stranded_seats、switched 都是 null（capacity r5 之前沒有來源）",
    "判定  紅：limit_hit 為真，已用完，換池資料無來源",
    "排序  已用完 > 過期（最舊在前）> 7 天最高",
  ],
  expanded: [
    "── 額度池（預測 = fleet 算，pane 不重算；近 6 時 = burn_window_h 6） ────────────────────────────────────────────────────────────────────────────── 資料 40 秒前",
    "    池                  7 天    5 小時   重置（台北）      近 6 時   預測    用完時間      席數   判定",
    "▸ ✗ personal            100%    100%     11-19 週四 08:00  +1.1/h    100%    已用完        5 席   已用完，換池資料無來源",
    "  ✗ team                68%     17%      11-21 週六 12:00  +1.9/h    >100%   11-18 18:00   3 席   約 17 時後用完，換池資料無來源",
    "  ✗ trinity             31%✗    0%✗      11-20 週五 06:00  +0.3/h✗   47%✗    —             1 席   ✗ 180 分未更新（>10 分；statusline 沒在跑）",
    "  ✗ twgame              49%     0%       11-19 週四 09:00  +1.4/h    94%     —             2 席   ✗ 席 twgame-2 過期 14 分，舊值 55% 較高",
    "  ▲ grok                10%     0%       11-24 週二 00:00  +0.0/h    10%     —             1 席   約剩 90% 會浪費",
    "  ▲ lab                 22%     4%       11-22 週日 10:00  +0.2/h    43%     —             2 席   約剩 57% 會浪費",
    "  ✓ codex               80%     12%      11-19 週四 21:00  +0.4/h    98%     —             2 席   會用到 98%",
    "",
    "── 焦點池 personal（Enter 收合各席） ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
    "席    capacity--claude · hangar--claude · … 共 5 席",
    "      capacity--claude  7天 100%  5小時 100%  0 分前",
    "      hangar--claude  7天 100%  5小時 100%  1 分前",
    "      old--claude  7天 97%✗  5小時 90%✗  14 分前",
    "換池  stranded_seats、switched 都是 null（capacity r5 之前沒有來源）",
    "判定  紅：limit_hit 為真，已用完，換池資料無來源",
    "排序  紅：已用完 > 最早用完 > 過期（最舊在前）；黃：浪費比例多的在前；最後才是綠",
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
  expect(last(row('personal'))).toBe(PALETTE.broken)
  expect(last(row('grok'))).toBe(PALETTE.attention)
  expect(last(row('codex'))).toBe(PALETTE.done)
  expect(row('trinity').find(s => s.text.includes('31%'))?.color).toBe(PALETTE.broken) // the stale number carries the red mark
  for (const r of rows) for (const s of r) { expect(s.background).toBeUndefined(); expect(s.inverse).toBeUndefined(); expect(s.bold).toBeUndefined() }
})

test('quota: the action area holds only the [f] switch advice, and only when capacity gave one for the focused pool', () => {
  const none = renderQuota(ctxOf(160, 40, consoleOf(POOLS)))
  expect(none.actions.length).toBe(0)
  const withAdvice = consoleOf(POOLS.map(p => (p.pool === 'personal' ? { ...p, switch_suggestion: 'personal -> team' } : p)))
  const a = renderQuota(ctxOf(160, 40, withAdvice)).actions
  expect(a.length).toBe(1)
  expect(text(a[0])).toBe('[f] 換池建議填入提示列（不送出）')
  // focus on a pool with no advice: no action
  expect(renderQuota(ctxOf(160, 40, withAdvice), { focus: 1, expanded: false }).actions.length).toBe(0)
})

test('quota: the page row order and the band pick agree (rank 0 = worstPool), and a pool past 10 minutes is stale without the feed flag', () => {
  const w = worstPool(POOLS as never, NOW) as { pool: string }
  expect(body(160, 40, consoleOf(POOLS)).find(l => l.startsWith('▸'))).toContain(w.pool)
  const aged = POOLS.map(p => (p.pool === 'codex' ? { ...p, observed_at_ms: NOW - 12 * MIN } : p))
  const line = body(160, 40, consoleOf(aged)).find(l => l.includes('codex')) as string
  expect(line).toContain('12 分未更新')
  expect(line).toContain('✗')
})
test('quota: the registry carries the framed quota page at key 4', () => {
  expect((page as { framed?: boolean }).framed).toBe(true)
  expect((page as { key: string }).key).toBe('4')
})

test('quota: no body row of the pool table is wider than the pane (nothing relies on the frame clip, so a verdict is never cut)', () => {
  const wide: string[] = []
  for (const [cols, rows] of SIZES)
    for (const c of [consoleOf(POOLS, { seats: SEATS }), consoleOf(NOPACE, { pace: false, seats: SEATS })])
      for (const l of body(cols, rows, c)) if (displayWidth(l) > cols) wide.push(cols + ': ' + l)
  expect(wide.join('\n')).toBe('')
})
