// gate3.test.ts — four real-host defects on feat/pane-batch1:
//   1. Quota page (額度): one row per pool at every width, short verdict via locales, full verdict in focus area, drop 重置 first then 近 6 時, never wrap a table row.
//   2. Short body (<= 4 body rows): no section titles and no column header, priority red pools -> unknown pools -> stuck lines, drop scroll hint from body; 額度 >= 1 pool, 現況 >= 1 item.
//   3. Strip never drops an entry (1-8, 9, 0, i): < 66 cols -> 2 rows (1-6, then 7, 8, 9, 0, i), >= 66 cols -> 1 row, fixed row count per width across pages, non-empty Button labels, fits with "<key>: ".
//   4. Band row 2 when pane is closed: draws new page names 1-8 as Buttons without digit hotkeys, no old console tab names, pressing a name opens the pane on that page.
import { test, expect } from 'claude-code/testing'
import { BandBar } from './band'
import { FOCUS_ANCHOR_KEY, Pane } from './pane'
import { frameHeight, frameRows, stripRows, STRIP_SPLIT_COLS } from './pages/frame'
import type { Page, Row } from './pages/frame'
import { nowPage } from './pages/now'
import { fleetPage } from './pages/fleet'
import { quotaPage, renderQuota } from './pages/quota'
import { PAGES } from './pages/index'
import { consoleOf, ctxOf, MIN, NOW, POOLS, SEATS, type Sources } from './pages/quota.fixture'
import { makeT } from './i18n'
import * as M from './model'
import { displayWidth } from './model'
import type { ConsoleSnapshot } from './console'

const tZh = makeT('zh-TW')
const tEn = makeT('en')
const OK = (): { at_ms: number; state: 'ok' } => ({ at_ms: NOW - 40000, state: 'ok' })
const ALL_OK: Sources = { tasks: OK(), hosts: OK(), cards: OK(), quota_now: OK(), quota_forecast: OK() }
const text = (r: { text: string }[]): string => r.map(s => s.text).join('')
const snap = (pools: unknown[] = POOLS, o: Parameters<typeof consoleOf>[1] = {}): ConsoleSnapshot => consoleOf(pools, { sources: ALL_OK, seats: SEATS, ...o }) as ConsoleSnapshot

type Node = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
const walk = (n: any, out: Node[] = []): Node[] => {
  if (n === null || n === undefined || n === false || typeof n !== 'object') return out
  if (Array.isArray(n)) { n.forEach(c => walk(c, out)); return out }
  if (n.kind !== undefined) out.push(n)
  walk(n.props?.children, out)
  return out
}
const flat = (n: any): string => {
  const c = n?.props?.children
  return typeof c === 'string' ? c : Array.isArray(c) ? c.flat(9).map((x: any) => (typeof x === 'string' ? x : x?.props ? flat(x) : '')).join('') : c?.props ? flat(c) : ''
}
const LIVE0 = { state: 'ok', text: 'x', header: 'x', band: { kind: 'idle', verdict: '', reason: null, project: 'x', elapsed: '1m', phase: '', slots: [] }, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW } } as never

const isButtonSeg = (s: { text: string; press?: string }): boolean => (s.press !== undefined && s.press.startsWith('tab:')) || s.text.startsWith('i ')
const hostWidth = (r: Row): number => r.reduce((w, s) => w + displayWidth(s.text) + (isButtonSeg(s) ? 1 : 0), 0)

test('gate3 item 1: quota draws exactly one row per pool at 160x40, 120x30, 80x24 and narrow docked widths, no continuation fragment, short verdict in table, full verdict in focus, dropping 重置 then 近 6 時', () => {
  const c = snap()
  for (const [cols, rows] of [[160, 40], [120, 30], [80, 24], [64, 24], [48, 24]] as const) {
    for (const loc of [tZh, tEn]) {
      const H = frameHeight(rows)
      const ctx = { ...(ctxOf(cols, H, c) as object), t: loc } as never
      const out = frameRows(quotaPage, ctx, { pages: PAGES }).map(text)
      expect(out.length).toBe(H)
      const stripLen = cols < STRIP_SPLIT_COLS ? 2 : 1
      const bodyRows = out.slice(1, out.length - stripLen - 1)
      const section = bodyRows.findIndex(l => l.trim() !== '')
      expect(section).toBeGreaterThanOrEqual(0)
      expect(bodyRows[section]).toContain('──')
      expect(bodyRows[section + 1]).toContain(loc('page.quota.col_pool'))
      const tableStart = section + 2
      const blankIdx = bodyRows.findIndex((l, i) => i >= tableStart && l.trim() === '')
      const tableRegion = blankIdx >= 0 ? bodyRows.slice(tableStart, blankIdx) : bodyRows.slice(tableStart)
      const poolRows = bodyRows.filter(l => /^[▸ ] [✗?▲✓] \S/.test(l))
      expect(tableRegion.length, cols + 'x' + rows + ': table region rows == pools shown').toBe(POOLS.length)
      expect(poolRows.length, cols + 'x' + rows + ': pool rows drawn == pools shown').toBe(POOLS.length)
      for (const r of tableRegion) {
        expect(/^[▸ ] [✗?▲✓] \S/.test(r), cols + 'x' + rows + ': not a continuation row: ' + r).toBe(true)
        expect(/^\s*[）)：；，]/.test(r), cols + 'x' + rows + ': no punctuation continuation fragment: ' + r).toBe(false)
        expect(displayWidth(r)).toBeLessThanOrEqual(cols)
      }
    }
  }
  // Short verdicts in table, full verdict in focus area
  const wide = renderQuota(ctxOf(160, 40, c) as never, { focus: 3, expanded: false }).body.map(text)
  const personalRow = wide.find(l => l.includes('personal')) as string
  const teamRow = wide.find(l => l.includes('team')) as string
  const grokRow = wide.find(l => l.includes('grok')) as string
  expect(personalRow).toContain('未知·缺換池')
  expect(personalRow).not.toContain('capacity')
  expect(teamRow).toContain('未知·17時用完')
  expect(teamRow).not.toContain('capacity')
  expect(grokRow).toContain('浪費 90%')
  expect(wide.join('\n'), 'focused pool gets the full verdict text in the focus area').toContain('已達額度上限，判定未知：缺換池資料（capacity）')

  // Column dropping order: 80 keeps 重置 and 近 6 時; 60 drops 重置 first and keeps 近 6 時; 48 drops 近 6 時 second
  const headAt = (cols: number) => renderQuota(ctxOf(cols, 24, c) as never).body.map(text)[1]
  expect(headAt(80)).toContain('重置')
  expect(headAt(80)).toContain('近 6 時')
  expect(headAt(60)).not.toContain('重置')
  expect(headAt(60)).toContain('近 6 時')
  expect(headAt(48)).not.toContain('重置')
  expect(headAt(48)).not.toContain('近 6 時')
  expect(headAt(48)).toContain('預測')
  expect(headAt(48)).toContain('判定')
})

test('gate3 item 2: when body has 4 rows or fewer, no section title and no column header are drawn; 額度 shows >= 1 pool row and 現況 shows >= 1 item ordered red pools -> unknown pools -> stuck lines', () => {
  const c = snap()
  // H = 5..7 at 80 cols -> S = 1, A = 1 on quota -> body room = 2, 3, 4 (all <= 4)
  for (const H of [5, 6, 7]) {
    const qOut = frameRows(quotaPage, ctxOf(80, H, c) as never, { pages: PAGES }).map(text)
    expect(qOut.length).toBe(H)
    const qBody = qOut.slice(1, H - 2)
    expect(qBody.length).toBeLessThanOrEqual(4)
    expect(qBody.some(l => l.includes('──')), 'H=' + H + ' quota: no section title').toBe(false)
    expect(qBody.some(l => l.includes('重置') || l.includes('7 天')), 'H=' + H + ' quota: no column header').toBe(false)
    // M2: a cut narrow table uses a pool-count hint once two pool-area rows fit; a pool row still stays visible.
    expect(qBody.some(l => /↓ 還有 \d+ 池（/.test(l)), 'H=' + H + ' quota: hidden-pool hint').toBe(H >= 6)
    expect(qBody.filter(l => /^[▸ ] [✗?▲✓] \S/.test(l)).length, 'H=' + H + ' quota: >= 1 pool row').toBeGreaterThanOrEqual(1)
  }
  // 現況 with no pending cards, 1 red pool, 1 unknown pool, and 1 offline/stuck line in a short body (C1: one summary row per class: fleet -> quota -> 另有 N 項)
  const oneRedOneUnknown = [
    POOLS.find(p => p.pool === 'trinity')!, // red (stale)
    POOLS.find(p => p.pool === 'personal')!, // unknown (limit_nosw)
    POOLS.find(p => p.pool === 'codex')!, // green
  ]
  const cNow = { ...(snap(oneRedOneUnknown, { cards: [], lines: [c.lines![1]] }) as object), items: [] } as ConsoleSnapshot
  expect(frameRows(nowPage, { ...(ctxOf(80, 4, cNow) as object), live: LIVE0 } as never, { pages: PAGES }).map(text)[1]).toBe('✗ 艦隊 ✗1 · 額度 ✗1 ?1 trinity · 另有 4 項') // X2b: severe classes lead; pool identity and overflow remain visible.
  for (const H of [5, 6, 7]) {
    const nOut = frameRows(nowPage, { ...(ctxOf(80, H, cNow) as object), live: LIVE0 } as never, { pages: PAGES }).map(text)
    expect(nOut.length).toBe(H)
    const nBody = nOut.slice(1, H - 2)
    expect(nBody.length).toBeLessThanOrEqual(4)
    expect(nBody.some(l => l.includes('──')), 'H=' + H + ' now: no section title').toBe(false)
    expect(nBody.filter(l => l.trim() !== '').length, 'H=' + H + ' now: >= 1 item').toBeGreaterThanOrEqual(1)
    const first = nBody.findIndex(l => l.trim() !== '')
    if (H === 5) {
      expect(nBody[first]).toBe('✗ 艦隊 離線 1 線（復原線）· 主機 2/3（離線 1）')
      expect(nBody[first + 1]).toBe('✗ 額度 紅 1（trinity）· ? 未知 1（personal）')
    }
    if (H === 7) {
      expect(nBody.some(l => l.includes('另有') || l.includes('還有')), 'H=7 now: both class summary rows fit without overflow').toBe(false)
      const iFleet = nBody.findIndex(l => l.includes('復原線') && l.includes('主機 2/3（離線 1）'))
      const iQuota = nBody.findIndex(l => l.includes('trinity') && l.includes('personal'))
      expect(iFleet, 'fleet class summary row first (no pending)').toBe(first)
      expect(iQuota, 'quota class summary row directly after fleet').toBe(iFleet + 1)
      expect(nBody[iQuota].indexOf('trinity')).toBeLessThan(nBody[iQuota].indexOf('personal'))
      expect(iQuota, 'last class row directly above actions').toBe(nBody.length - 1)
    }
  }
})

test('gate3 item 2 (R2/C1 pending-first): short body with pending cards puts combined Button+summary pending row first, drops duplicate 到待決頁 action row, orders red pools -> offline hosts -> stuck lines -> unknown -> yellow, and uses 另有 N 項 for overflow', () => {
  const c0 = snap()
  const cards = [
    { id: 'd-00000001', question: '是否先切流到備援節點再重啟語音線服務', status: 'open' as const, opened_at_ms: NOW - 24 * 60 * MIN, executor_display: 'PM' },
    { id: 'd-00000002', question: 'q2', status: 'open' as const, opened_at_ms: NOW - 60 * MIN, executor_display: 'PM' },
    { id: 'd-00000003', question: 'q3', status: 'open' as const, opened_at_ms: NOW - 10 * MIN, executor_display: 'PM' },
  ]
  const pools = [
    POOLS.find(p => p.pool === 'trinity')!,
    POOLS.find(p => p.pool === 'personal')!,
    POOLS.find(p => p.pool === 'grok')!,
  ]
  const withPending = { ...(snap(pools, { cards, lines: [c0.lines![1]] }) as object), items: [] } as ConsoleSnapshot
  const out = frameRows(nowPage, { ...(ctxOf(80, 7, withPending) as object), live: LIVE0 } as never, { pages: PAGES })
  expect(out.length).toBe(7)
  expect(out[1]).toEqual([{ text: '' }])
  expect(out[2][0].press).toBe('tab:2:decide')
  expect(out.map(text).join('\n')).not.toContain('到待決頁')
  const nBody = out.slice(1, 6).map(text)
  expect(nBody[0]).toBe('')
  expect(nBody[1]).toBe('→ 待決 3 張（最舊 1 天）：是否先切流到備援節點再重啟語音線服務')
  expect(nBody[2]).toBe('✗ 艦隊 離線 1 線（復原線）· 主機 2/3（離線 1）')
  expect(nBody[3]).toBe('✗ 額度 紅 1（trinity）· ? 未知 1（personal）')
  expect(nBody[4]).toBe('另有 1 項（現況 ▲1）') // X2: include hidden category/severity.
})

test('gate3 item 3: at 40, 49, 60, 65 and 66 columns every entry (1-8, 9, 0, i) is present with a non-empty label, < 66 uses 2 rows (1-6 then 7, 8, 9, 0, i) and >= 66 uses 1 row across all pages, fitting host "<key>: " width', () => {
  const c = snap()
  const shown: Page[] = PAGES.map(p => ({ ...p, framed: true as const }))
  for (const cols of [40, 49, 60, 65, 66]) {
    const wantStripRows = cols < 66 ? 2 : 1
    const counts = new Set<number>()
    for (const loc of [tZh, tEn]) {
      for (const page of PAGES) {
        const ctx = { ...(ctxOf(cols, 24, c) as object), t: loc } as never
        const sRows = stripRows(page, ctx, { pages: PAGES })
        counts.add(sRows.length)
        expect(sRows.length, cols + ' ' + page.id + ' strip row count').toBe(wantStripRows)
        const framed = frameRows(page, ctx, { pages: PAGES })
        expect(framed.length, cols + ' ' + page.id + ': H stays 24').toBe(24)
        const drawnStrip = framed.slice(-wantStripRows)
        for (const r of drawnStrip) expect(hostWidth(r), cols + ' ' + page.id + ' strip width <= cols: ' + text(r)).toBeLessThanOrEqual(cols)
        if (cols < 66) {
          const r1Keys = drawnStrip[0].filter(s => s.press !== undefined).map(s => s.text.split(' ')[0])
          const r2Keys = drawnStrip[1].filter(s => s.press !== undefined).map(s => s.text.split(' ')[0])
          expect(r1Keys).toEqual(['1', '2', '3', '4', '5', '6'])
          expect(r2Keys).toEqual(['7', '8', '9', '0'])
          expect(drawnStrip[1].some(s => /^i \S/.test(s.text))).toBe(true)
        } else {
          const keys = drawnStrip[0].filter(s => s.press !== undefined).map(s => s.text.split(' ')[0])
          expect(keys).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
          expect(drawnStrip[0].some(s => /^i \S/.test(s.text))).toBe(true)
        }
        for (const r of drawnStrip) {
          for (const s of r.filter(x => x.press !== undefined)) expect(s.text, 'non-empty tab label').toMatch(/^[0-9] \S/)
        }
      }
      // Verify through Pane component: every Button has a non-empty label and each drawn row fits cols with "<key>: "
      const tree = Pane(EL as never, LIVE0, 'now', () => {}, loc, cols, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: shown, console: c, nowMs: NOW, rows: 24 } as never)
      const allBtns = walk(tree).filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY)
      expect(allBtns.filter(b => flat(b).trim() === '').map(b => b.props.key), cols + ': no empty-label Button').toEqual([])
      expect(allBtns.filter(b => /^[0-9]$/.test(b.props.hotkey ?? '')).map(b => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
      expect(allBtns.some(b => b.props.hotkey === 'i' && flat(b).trim().length > 0)).toBe(true)
    }
    expect(counts.size, cols + ': strip row count never changes between pages').toBe(1)
  }
  // At 65 cols (zh-TW), 2-row strip keeps full labels because both rows fit; at 40 cols row 1 shortens to first character
  const s65 = stripRows(nowPage, ctxOf(65, 24, c) as never, { pages: PAGES }).map(text)
  expect(s65[0]).toContain('1 現況')
  expect(s65[1]).toContain('7 花費')
  const s40 = stripRows(nowPage, ctxOf(40, 24, c) as never, { pages: PAGES }).map(text)
  expect(s40[0]).toBe('1 現 2 待 3 艦 4 額 5 派 6 審')
})

test('gate3 item 4: BandBar with pane closed in console mode draws new page names 1-8 as Buttons without digit hotkeys and no old console tab names', () => {
  const c = snap()
  const pressed: string[] = []
  const bar = BandBar(EL as never, LIVE0, 120, tZh, { onInfo: () => {}, onSlot: () => {}, onTab: id => pressed.push(id) }, null, null, true, null, { snap: c, tab: 'command', cols: 120 }, null, null, false)
  const top = bar.node as Node
  const kids = ([] as any[]).concat(top.props.children).filter(Boolean)
  expect(kids.length, 'closed console band has 2 rows').toBe(2)
  const row2Text = flat(kids[1])
  for (const name of ['現況', '待決', '艦隊', '額度', '派工', '審查', '花費', '殘留']) expect(row2Text).toContain(name)
  for (const old of ['指揮', '團隊', '主機', '本席']) expect(row2Text).not.toContain(old)
  const row2Btns = walk(kids[1]).filter(n => n.kind === 'Button')
  // M6: the closed band also lists the pet and forge pages, without digit hotkeys.
  expect(row2Btns.map(b => b.props.key)).toEqual(['tab:now', 'tab:decide', 'tab:fleet', 'tab:quota', 'tab:dispatch', 'tab:review', 'tab:spend', 'tab:hygiene', 'tab:pet', 'forge'])
  for (const b of row2Btns) {
    expect(b.props.hotkey, 'no digit hotkey on band Button').toBeUndefined()
    expect(flat(b).trim().length).toBeGreaterThan(0)
    b.props.onPress()
  }
  expect(pressed).toEqual(['now', 'decide', 'fleet', 'quota', 'dispatch', 'review', 'spend', 'hygiene', 'pet', 'forge'])
  void MIN
})

test('gate4 empty state with pending cards: 3 pending cards (console.cards or live.pending) with sources ok on 艦隊 and 額度 shows page.now.go_decide (after frame.unknown_pools when n > 0), never 沒有要你處理的事 or 沒有待決卡', () => {
  const threeConsoleCards = [
    { id: 'd-00000001', question: 'q1', status: 'open', opened_at_ms: NOW - 3 * MIN, executor_display: null },
    { id: 'd-00000002', question: 'q2', status: 'open', opened_at_ms: NOW - 2 * MIN, executor_display: null },
    { id: 'd-00000003', question: 'q3', status: 'open', opened_at_ms: NOW - MIN, executor_display: null },
  ]
  const mkOwn = (id: string, kind = 'decide') => ({ id, title: null, question: 'q ' + id, background: null, options: [], recommendation: null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: 60, origin: null, orphaned: false, kind })
  const threeLiveCards = [mkOwn('d-aaaa0001'), mkOwn('d-aaaa0002'), mkOwn('d-aaaa0003')]
  const greenPools = [POOLS.find(p => p.pool === 'codex')!]
  const redPools = POOLS.map(p => ({ ...p, stranded_seats: 1 }))
  const unknownPools = POOLS // 2 unknown pools (personal, team)

  const emptyActRow = (page: Page, c: ConsoleSnapshot, live: unknown = null, loc = tZh): string => {
    const out = frameRows(page, { ...(ctxOf(120, 24, c) as object), live, t: loc } as never, { pages: PAGES }).map(text)
    return out[out.length - 2]
  }

  // 1. 3 pending cards in ctx.console.cards, all sources ok, empty page actions on 艦隊 (lines: []) and 額度
  for (const page of [fleetPage, quotaPage]) {
    const green3 = snap(greenPools, { cards: threeConsoleCards, lines: [] })
    expect(green3.cards?.length).toBe(3)
    expect(emptyActRow(page, green3)).toBe('待決 3 張卡等你')
    expect(emptyActRow(page, green3)).not.toContain('沒有要你處理的事')
    expect(emptyActRow(page, green3)).not.toContain('沒有待決卡')
    expect(emptyActRow(page, green3, null, tEn)).toBe('3 cards wait for you')

    const red3 = snap(redPools, { cards: threeConsoleCards, lines: [] })
    expect(emptyActRow(page, red3)).toBe('待決 3 張卡等你')
    expect(emptyActRow(page, red3)).not.toContain('沒有待決卡')

    const unk3 = snap(unknownPools, { cards: threeConsoleCards, lines: [] })
    expect(emptyActRow(page, unk3)).toBe('2 池判定未知（缺換池資料）；待決 3 張卡等你')
    expect(emptyActRow(page, unk3)).not.toContain('沒有待決卡')
    expect(emptyActRow(page, unk3, null, tEn)).toBe('2 pools: verdict unknown (no rebalance data)；3 cards wait for you')

    // 2. 3 pending cards in ctx.live.pending (0 console cards), all sources ok
    const liveWith3 = { ...(LIVE0 as object), pending: threeLiveCards }
    const green0 = snap(greenPools, { cards: [], lines: [] })
    expect(emptyActRow(page, green0, liveWith3)).toBe('待決 3 張卡等你')
    expect(emptyActRow(page, snap(redPools, { cards: [], lines: [] }), liveWith3)).toBe('待決 3 張卡等你')
    expect(emptyActRow(page, snap(unknownPools, { cards: [], lines: [] }), liveWith3)).toBe('2 池判定未知（缺換池資料）；待決 3 張卡等你')

    // Deduplication across console.cards and live.pending, and step cards excluded
    const overlapConsole = snap(greenPools, { cards: threeConsoleCards.slice(0, 2), lines: [] })
    const overlapLive = { ...(LIVE0 as object), pending: [mkOwn('d-00000002'), mkOwn('d-aaaa0003'), mkOwn('d-aaaa0009', 'step')] }
    expect(emptyActRow(page, overlapConsole, overlapLive)).toBe('待決 3 張卡等你')

    // 3. 0 pending cards control: 沒有要你處理的事 only with 0 pending cards, all sources ok and no unknown/needing pool
    const stepOnlyLive = { ...(LIVE0 as object), pending: [mkOwn('d-aaaa0009', 'step')] }
    expect(emptyActRow(page, green0, stepOnlyLive)).toBe('沒有要你處理的事')
    expect(emptyActRow(page, snap(redPools, { cards: [], lines: [] }), LIVE0)).toBe('沒有待決卡')
    expect(emptyActRow(page, snap(unknownPools, { cards: [], lines: [] }), LIVE0)).toBe('2 池判定未知（缺換池資料）；沒有待決卡')
  }

  // Short-body priority when pending-cards line competes for the short body on 現況 (R2/C1): pending Button -> fleet class summary -> quota class summary, bottom-anchored with no duplicate 到待決頁
  const oneRedOneStuck = snap(
    [POOLS.find(p => p.pool === 'trinity')!, POOLS.find(p => p.pool === 'codex')!],
    { cards: threeConsoleCards, items: [], lines: [{ line_id: 'recovery', label: '復原線', lead_display: null, issues: [{ rule: 'T4', state: 'failed', subject: '復原線成員', since_ms: NOW - 10 * MIN, to_console: true }] }] },
  )
  const cleanSnap = { ...oneRedOneStuck, items: [] } as ConsoleSnapshot
  const fullOut = frameRows(nowPage, { ...(ctxOf(80, 7, cleanSnap) as object), live: LIVE0 } as never, { pages: PAGES }).map(text)
  expect(fullOut.join('\n')).not.toContain('到待決頁')
  const nBody = fullOut.slice(1, 6)
  expect(nBody.slice(0, 2)).toEqual(['', ''])
  const pending = nBody.findIndex(l => l.includes('待決 3 張'))
  expect(pending).toBe(nBody.findIndex(l => l.trim() !== ''))
  expect(nBody[pending + 1]).toBe('✗ 艦隊 離線 1 線（復原線）· 主機 2/3（離線 1）')
  expect(nBody[pending + 2]).toBe('✗ 額度 紅 1（trinity）')
  expect(pending + 2, 'last item directly above strip').toBe(nBody.length - 1)
})
