// decide.test.ts — S1 (pane tabs r2, PM 01M7N307): the 待決 page against the codeforge mockups (e014900), row for row.
// Golden = the mockup's body and action rows (the frame's own header and strip rows are frame.golden.test.ts's). The mockups were drawn by hand, so the comparison
// is tolerant in exactly three ways (see `norm`): a run of blanks or of rule dashes inside a row counts as one, and a blank between a number and its unit (40 分 / 40分) is
// ignored. Everything else (every word, glyph, label, row order, row count) must be equal. DEVIATIONS lists the places where the mockup contradicts itself and what the page draws instead.
import { test, expect } from 'claude-code/testing'
import { PAGES } from './index'
import { frameRows, actionRows } from './frame'
import type { Page } from './frame'
import { decidePage, decideReduce, NO_NAV } from './decide'
import type { DecideNav } from './decide'
import { routeKey } from './keys'
import { makeT } from '../i18n'
import { displayWidth } from '../model'
import { parseConsole } from '../console'
import full from '../fixtures/console/console-full.fixture'

const t = makeT('zh-TW')
const nowMs = 1794200000000
const text = (row: { text: string }[]) => row.map(s => s.text).join('')
const norm = (s: string) => s.replace(/─+/g, '─').replace(/(\S) {2,}(?=\S)/g, '$1 ').replace(/(\d) ([分時天秒])/g, '$1$2').trimEnd()
const dec = (o: Record<string, unknown>) => ({ id: null, title: null, question: '', background: null, options: [], recommendation: null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: null, origin: null, orphaned: false, kind: 'decide', ...o })
const opts = (...labels: string[]) => labels.map(label => ({ label, description: '' }))
const live = (...pending: unknown[]) => ({ state: 'ok', header: '', pending }) as never
const okSrc = { at_ms: nowMs - 12000, state: 'ok' }
const con = (cards: unknown[] | null, items: unknown[], lines: unknown[] = [], sources: Record<string, unknown> = { cards: okSrc }) => ({ generated_at_ms: nowMs, sources, counts: { decisions: 0, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: {}, hosts: {}, hints: 0, quota_worst: null } }, quota: { pools: null, seats: [] }, items, cards, lines }) as never
const ctxOf = (cols: number, rows: number, l: unknown, c: unknown, decide?: DecideNav) => ({ live: l, console: c, size: { cols, rows }, t, nowMs, ...(decide === undefined ? {} : { decide }) }) as never
const nav = (o: Partial<DecideNav>): DecideNav => ({ ...NO_NAV, ...o })
const mirror = (title: string, line: string) => ({ id: 'exc:T7:aa', kind: 'exception', severity: 3, state: 'findings', needs_operator: false, title, text: title + ' d-1c0a77e2', since_ms: nowMs - 3600000, line_id: line, to_console: true, answerable_by: [] })
const farLines = [{ line_id: 'h6', label: 'h6', lead_display: 'cookys/h6/game-lead--claude', issues: [] }]
const card = (id: string, question: string, who: string, ago: number) => ({ id, question, status: 'open', opened_at_ms: nowMs - ago, executor_display: who })
const H = 3600000
const AGE40 = 2400

const GOLD = {
 "w160": {
  "body": [
   "▸ d-89fe394f 1/3  feature/legacy-payment-rewrite 和 feature/social-login 依序 --no-ff 合進 legacy？     執行者 game-lead · 40 分",
   "  背景   兩支分支都過審，合併順序影響 migration 編號",
   "  卡住   game-lead 的 row 不能自己合 main 以外的 legacy 分支",
   "  [a] 可以 ★    [b] 先不要",
   "  建議   可以：先 payment 再 social，CI 綠才合第二支",
   "  補充   （按 n 寫補充，會跟答案一起送）",
   "",
   "── 其他待決 2（z 收合）──────────────────────────────",
   "  d-fd51ee8d  下次到 308 現場時量 30 格（要你到場，只能回報）                             308 · 1 天",
   "  d-fb890f48  [測試卡] carddispatch 真 courier 紅綠，請勿在面板作答                       PM · 2 時",
   "── 別台的卡（唯讀，到那一席答）────────────────────────────",
   "  d-1c0a77e2  h6 席：GPU slot 重排要你點頭 → 到 cookys/h6/game-lead--claude 答",
   "── 要你做或看 ──────────────────────────────────────────",
   "  步驟  01M7N2TZ 上線後看 pane 截圖"
  ],
  "actions": [
   "已選 a 可以（尚未送出）",
   "a–b: 選項（每張卡最多 5 個選項 a–e）   [n] 補充（輸入中數字字母都是文字，Enter/Esc 結束）",
   "[s] 送出焦點卡（Enter 按下焦點按鈕）   [u] 送出後 10 秒內撤回",
   "[h] 上一張  [l] 下一張  [z] 收合其他待決",
   "[f] 回報填入提示列（不送出）"
  ]
 },
 "w120": {
  "body": [
   "▸ d-4c2e19a0 2/3  馬拉松分支 5 支怎麼合進 release？                       執行者 game-lead · 2 時",
   "  背景   五支分支互相有衝突，合併順序決定誰要 rebase",
   "  卡住   game-lead 只能合 main，release 要你點頭",
   "  [a] 全部一次合",
   "  [b] 依序合，每支綠才合下一支 ★",
   "  [c] 拆兩批，每批 2–3 支",
   "  [d] 只合前兩支，其餘下週",
   "  [e] 先不要",
   "  建議   [a] 一次全合；風險是一支壞全壞",
   "  補充   （按 n 寫補充，會跟答案一起送）",
   "",
   "── 其他待決 2（z 收合）───────────────────────────────",
   "  d-fd51ee8d  下次到 308 現場時量 30 格（要你到場，只能回報）                     308 · 1 天",
   "  d-fb890f48  [測試卡] carddispatch 真 courier 紅綠，請勿在面板作答               PM · 2 時"
  ],
  "actions": [
   "已選 c 拆兩批，每批 2–3 支（尚未送出）",
   "a–e: 選項（卡上限 5 個）   [n] 補充（輸入中數字字母都是文字，Enter/Esc 結束）",
   "[s] 送出焦點卡（Enter 按下焦點按鈕）   [u] 送出後 10 秒內撤回   [f] 回報填入提示列（不送出）",
   "[h] 上一張  [l] 下一張  [z] 收合其他待決"
  ]
 },
 "c80": {
  "body": [
   "▸ payment 和 social-login 依序 --no-ff 合進 legacy？",
   "  d-89fe394f 1/3 · game-lead · 40 分",
   "背景 兩支都過審，順序影響 migration",
   "[a] 可以 ★   [b] 先不要",
   "建議 可以：先 payment 再 social",
   "── 其他待決 2（z 收合）──",
   "d-fd51ee8d 308 現場量 30 格 · 1天",
   "d-fb890f48 [測試卡] 請勿作答 · 2時",
   "── 別台（唯讀）──",
   "d-1c0a77e2 h6：GPU 重排 → 到該席答",
   "── 要你做或看 ──",
   "01M7N2TZ 上線後看截圖"
  ],
  "actions": [
   "已選 a（尚未送出） [n] 補充",
   "[s] 送出  [u] 10 秒內撤回",
   "[h] 上張 [l] 下張 [f] 填入提示列"
  ]
 },
 "c80_folded": {
  "body": [
   "▸ payment 和 social-login 依序 --no-ff 合進 legacy？",
   "  d-89fe394f 1/3 · game-lead · 40 分",
   "背景 兩支都過審，順序影響 migration",
   "[a] 可以 ★   [b] 先不要",
   "建議 可以：先 payment 再 social",
   "── 其他待決 2（z 展開）──",
   "── 別台（唯讀）──",
   "d-1c0a77e2 h6：GPU 重排 → 到該席答",
   "── 要你做或看 ──",
   "01M7N2TZ 上線後看截圖"
  ],
  "actions": [
   "已選 a（尚未送出） [n] 補充",
   "[s] 送出  [u] 10 秒內撤回",
   "[h] 上張 [l] 下張 [z] 展開其他"
  ]
 },
 "c80_open": {
  "body": [
   "▸ payment 和 social-login 依序 --no-ff 合進 legacy？",
   "  d-89fe394f 1/3 · game-lead · 40 分",
   "背景 兩支都過審，順序影響 migration",
   "[a] 可以 ★   [b] 先不要",
   "建議 可以：先 payment 再 social",
   "── 其他待決 2（z 收合）──",
   "d-fd51ee8d 308 現場量 30 格 · 1天",
   "d-fb890f48 [測試卡] 請勿作答 · 2時",
   "── 別台（唯讀）──",
   "d-1c0a77e2 h6：GPU 重排 → 到該席答",
   "── 要你做或看 ──",
   "01M7N2TZ 上線後看截圖"
  ],
  "actions": [
   "已選 a（尚未送出） [n] 補充",
   "[s] 送出  [u] 10 秒內撤回",
   "[h] 上張 [l] 下張 [f] 填入提示列"
  ]
 },
 "c80_sent": {
  "body": [
   "▸ payment 和 social-login 依序 --no-ff 合進 legacy？",
   "  d-89fe394f 1/3 · game-lead · 40 分",
   "已送出：[b] 先不要",
   "── 其他待決 2（z 收合）──",
   "d-fd51ee8d 308 現場量 30 格 · 1天",
   "d-fb890f48 [測試卡] 請勿作答 · 2時",
   "── 別台（唯讀）──",
   "d-1c0a77e2 h6：GPU 重排 → 到該席答"
  ],
  "actions": [
   "已送出 b，8 秒內按 u 撤回",
   "[h] 上張 [l] 下張（可先看別張）"
  ]
 },
 "c80_zero": {
  "body": [
   "○ 目前沒有待決卡",
   "── 別台的卡（唯讀）──",
   "○ 沒有"
  ],
  "actions": []
 },
 "c80_old6": {
  "body": [
   "▸ 六條合併策略選哪一條？",
   "  d-2b7710cc 1/1 · game-lead · 3 時（舊卡，6 個選項）",
   "[a] 全合  [b] 依序  [c] 兩批",
   "[d] 前兩支  [e] 先不要",
   "[f6] 第 6 項：只合 hotfix",
   "── 其他待決 0 ──"
  ],
  "actions": [
   "已選 第 6 項 只合 hotfix（尚未送出）",
   "[s] 送出焦點項（Enter 按下焦點按鈕）   [u] 10 秒內撤回",
   "j/k 移焦點   [n] 補充"
  ]
 }
} as Record<string, { body: string[]; actions: string[] }>

// ---- fixtures: one per mockup state (the hand-drawn 80-column mockups use shorter sentences than the 160 / 120 ones, so each size has its own card texts) ----
const own160 = dec({ id: 'd-89fe394f', question: 'feature/legacy-payment-rewrite 和 feature/social-login 依序 --no-ff 合進 legacy？', background: '兩支分支都過審，合併順序影響 migration 編號', blocks: 'game-lead 的 row 不能自己合 main 以外的 legacy 分支', recommendation: '可以：先 payment 再 social，CI 綠才合第二支', options: opts('可以', '先不要'), source: 'game-lead', age_s: AGE40 })
const step160 = dec({ title: '01M7N2TZ 上線後看 pane 截圖', question: '01M7N2TZ 上線後看 pane 截圖', kind: 'step' })
const con160 = con([card('d-fb890f48', '[測試卡] carddispatch 真 courier 紅綠，請勿在面板作答', 'PM', 2 * H), card('d-fd51ee8d', '下次到 308 現場時量 30 格（要你到場，只能回報）', '308', 24 * H)], [mirror('h6 席：GPU slot 重排要你點頭', 'h6')], farLines)
const own120 = dec({ id: 'd-4c2e19a0', question: '馬拉松分支 5 支怎麼合進 release？', background: '五支分支互相有衝突，合併順序決定誰要 rebase', blocks: 'game-lead 只能合 main，release 要你點頭', recommendation: '依序合，每支綠才合下一支', options: opts('全部一次合', '依序合，每支綠才合下一支', '拆兩批，每批 2–3 支', '只合前兩支，其餘下週', '先不要'), source: 'game-lead', age_s: 2 * 3600 })
const con120 = con(con160.cards, [])
const own80 = dec({ id: 'd-89fe394f', question: 'payment 和 social-login 依序 --no-ff 合進 legacy？', background: '兩支都過審，順序影響 migration', recommendation: '可以：先 payment 再 social', options: opts('可以', '先不要'), source: 'game-lead', age_s: AGE40 })
const step80 = dec({ title: '01M7N2TZ 上線後看截圖', question: '01M7N2TZ 上線後看截圖', kind: 'step' })
const con80 = con([card('d-fb890f48', '[測試卡] 請勿作答', 'PM', 2 * H), card('d-fd51ee8d', '308 現場量 30 格', '308', 24 * H)], [mirror('h6：GPU 重排', 'h6')], farLines)
const old6 = dec({ id: 'd-2b7710cc', question: '六條合併策略選哪一條？', options: opts('全合', '依序', '兩批', '前兩支', '先不要', '只合 hotfix'), source: 'game-lead', age_s: 3 * 3600 })

type Case = { name: string; ctx: unknown; gold: { body: string[]; actions: string[] } }
const DEVIATIONS: Record<string, [string, string][]> = {
  // G11: undo is a visible [u] Button (the pane cannot take the keyboard on the real host), so the held row reads `已送出 b  [u] 8 秒內撤回`, not the mockup's `按 u 撤回`.
  c80_sent: [['已送出 b，8 秒內按 u 撤回', '已送出 b  [u] 8 秒內撤回']],
  // the 120 mockup is "2/3" with the other two cards listed, which leaves no card 1; and its 建議 row reads "[a] 一次全合…" while the star sits on [b]. The page counts 1/3 and draws the recommendation of the starred option.
  w120: [['2/3', '1/3'], ['建議   [a] 一次全合；風險是一支壞全壞', '建議   依序合，每支綠才合下一支']],
}
const swap = (rows: string[], pairs: [string, string][]) => rows.map(r => pairs.reduce((x, [a, b]) => x.replace(a, b), r))
const CASES: Case[] = [
  { name: 'w160', ctx: ctxOf(160, 40, live(own160, step160), con160, nav({ picks: { 'd-89fe394f': 0 } })), gold: GOLD.w160 },
  { name: 'w120', ctx: ctxOf(120, 30, live(own120), con120, nav({ picks: { 'd-4c2e19a0': 2 } })), gold: GOLD.w120 },
  { name: 'c80', ctx: ctxOf(80, 24, live(own80, step80), con80, nav({ picks: { 'd-89fe394f': 0 } })), gold: GOLD.c80 },
  { name: 'c80_folded', ctx: ctxOf(80, 24, live(own80, step80), con80, nav({ picks: { 'd-89fe394f': 0 }, folded: true })), gold: GOLD.c80_folded },
  { name: 'c80_open', ctx: ctxOf(80, 24, live(own80, step80), con80, nav({ picks: { 'd-89fe394f': 0 } })), gold: GOLD.c80_open },
  { name: 'c80_sent', ctx: ctxOf(80, 24, live(own80), con80, nav({ picks: { 'd-89fe394f': 1 }, hold: { 'd-89fe394f': nowMs - 2000 } })), gold: GOLD.c80_sent },
  { name: 'c80_zero', ctx: ctxOf(80, 24, live(), con(null, []) && con([], [])), gold: GOLD.c80_zero },
  { name: 'c80_old6', ctx: ctxOf(80, 24, live(old6), con([], []), nav({ picks: { 'd-2b7710cc': 5 }, opt: 5 })), gold: GOLD.c80_old6 },
]

for (const c of CASES) {
  test(`decide golden ${c.name}: body and action rows equal the mockup`, () => {
    const out = decidePage.render(c.ctx as never)
    const want = (rows: string[]) => swap(rows, DEVIATIONS[c.name] ?? []).map(norm)
    expect(out.body.map(text).map(norm)).toEqual(want(c.gold.body))
    expect(out.actions.map(text).map(norm)).toEqual(want(c.gold.actions))
  })
  test(`decide ${c.name}: rows fit the width, actions fit the area, frameRows is exactly H rows`, () => {
    const ctx = c.ctx as { size: { cols: number; rows: number } }
    const out = decidePage.render(ctx as never)
    expect(out.actions.length <= actionRows(ctx.size.rows)).toBe(true)
    // a body row longer than the pane is cut by frameRows; the page keeps every row within the width except where the mockup's own long sentence is
    const framed = frameRows(decidePage, ctx as never)
    expect(framed.length).toBe(ctx.size.rows)
    for (const r of framed) expect(displayWidth(text(r)) <= ctx.size.cols).toBe(true)
  })
}

test('decide: the control — a changed word is not equal after norm (the golden compare can go red)', () => {
  expect(norm('已選 a 可以（尚未送出）')).not.toBe(norm('已選 b 可以（尚未送出）'))
  expect(norm('──────')).toBe(norm('──'))
  expect(norm('40 分')).toBe(norm('40分'))
  expect(norm('背景 兩支')).not.toBe(norm('背景兩支'))
})

test('decide: the shell entry is replaced and the page is framed', () => {
  const p = PAGES.find(x => x.id === 'decide') as Page
  expect(p).toBe(decidePage)
  expect(p.key).toBe('2')
  expect(p.framed).toBe(true)
})

// ---- every size, every data state: exactly H rows, never a throw ----
const SIZES = [[160, 40], [120, 30], [80, 24]] as const
test('decide: null live and null console render the no-source rows at every size, never throw', () => {
  for (const [cols, rows] of SIZES) {
    const ctx = ctxOf(cols, rows, null, null)
    const body = decidePage.render(ctx).body.map(text).join('\n')
    expect(body).toContain('本席待決資料無來源')
    expect(body).toContain('此帳號沒有 console 快照')
    expect(frameRows(decidePage, ctx).length).toBe(rows)
    expect(decidePage.render(ctx).actions).toEqual([])
  }
})

test('decide: console cards list missing, or a stale cards source, is a red row with its reason', () => {
  const ctx = ctxOf(80, 24, live(own80), con(null, []))
  expect(decidePage.render(ctx).body.map(text).join('\n')).toContain('console 沒有卡片資料來源')
  const stale = ctxOf(80, 24, live(own80), con([], [], [], { cards: { at_ms: nowMs - 12 * 60000, state: 'stale' } }))
  const rows = decidePage.render(stale).body
  expect(text(rows[0])).toContain('卡 資料過期，12 分鐘前')
  expect(rows[0][0].color).toBe('error' as never) // the broken role (frame.ts brokenRow)
  const expired = ctxOf(80, 24, live(own80), con([], [], [], { cards: { at_ms: null, state: 'no_source' } }))
  expect(text(decidePage.render(expired).body[0])).toContain('卡 無來源')
  expect(decidePage.render(ctxOf(80, 24, { state: 'stale', header: '15 分鐘前', pending: [] } as never, con([], []))).body.map(text).join('\n')).toContain('本席待決資料不是最新：15 分鐘前')
})

test('decide A10: a stale reason is never truncated: at 70 columns it wraps onto further rows, no row ends in …', () => {
  const why = '沒有專案 · 請執行：autopilot status runs --watch 再重新整理本席待決資料'
  const out = frameRows(decidePage, ctxOf(70, 24, { state: 'stale', header: why, pending: [] } as never, con([], [])))
  expect(out.length).toBe(24)
  const joined = out.map(text).join('\n')
  expect(joined.replace(/\s+/g, ''), 'the whole reason is on screen').toContain(('本席待決資料不是最新：' + why).replace(/\s+/g, ''))
  expect(out.map(text).filter(r => r.includes('…')), 'no row is cut with …').toEqual([])
  expect(out.every(r => displayWidth(text(r)) <= 70)).toBe(true)
})

test('decide M7: pending_no_source names only the missing sources and wraps without truncating at 80 and 40 columns', () => {
  const noPointer = { state: 'no-pointer', header: '沒有指標檔', pending: [] } as never
  const noProject = { state: 'no-project', header: '沒有專案', pending: [] } as never
  const noCardsCon = con(null, [], [], { cards: { at_ms: null, state: 'no_source' } })

  for (const cols of [80, 40] as const) {
    const out = frameRows(decidePage, ctxOf(cols, 24, noPointer, null))
    expect(out.length).toBe(24)
    for (const r of out) expect(displayWidth(text(r))).toBeLessThanOrEqual(cols)
    expect(out.map(text).join('')).toContain('✗ 待決 ? 張（無來源：沒有指標檔、沒有 console 快照）')
    expect(out.map(text).filter(r => r.includes('…'))).toEqual([])
  }

  const ptrOnly = frameRows(decidePage, ctxOf(80, 24, noPointer, noCardsCon)).map(text).join('')
  expect(ptrOnly).toContain('✗ 待決 ? 張（無來源：沒有指標檔）')
  expect(ptrOnly).not.toContain('沒有 console 快照')

  const conOnly = frameRows(decidePage, ctxOf(80, 24, noProject, null)).map(text).join('')
  expect(conOnly).toContain('✗ 待決 ? 張（無來源：沒有 console 快照）')
  expect(conOnly).not.toContain('沒有指標檔')
})

test('decide: a long list never changes the frame height (overflow ends in the more row)', () => {
  const many = Array.from({ length: 30 }, (_, i) => card('d-' + String(i).padStart(8, '0'), '第 ' + i + ' 張', 'PM', H))
  for (const [cols, rows] of SIZES) {
    const out = frameRows(decidePage, ctxOf(cols, rows, live(own80), con(many, [])))
    expect(out.length).toBe(rows) // an overflowing list fills the surface
    expect(out.some(r => text(r).includes('還有')), 'the overflow ends in the more row').toBe(true)
  }
})

test('decide: a console card in focus is read-only and names the seat that answers it', () => {
  // N1 (codeforge B49-B54, S1-full-p2-160x40 row 27): with no own card the card that has waited longest (d-fd51ee8d, 1 天) is focused, not the 2 時 one
  const ctx = ctxOf(80, 24, live(), con160, nav({}))
  const o = decidePage.render(ctx)
  expect(text(o.body[0])).toContain('下次到 308 現場時量 30 格')
  expect(text(o.body[1])).toContain('d-fd51ee8d 1/2 · 308')
  expect(text(o.actions[0])).toBe('這張要到 308 答，這裡只能看')
})

test('decide R2 & R11: at 80x24 card question comes before owner seat and age; wide single-row other-card titles cut with … keeping age fixed at right edge', () => {
  const out80 = decidePage.render(ctxOf(80, 24, live(own80), con80)).body.map(text)
  expect(out80[0]).toBe('▸ payment 和 social-login 依序 --no-ff 合進 legacy？')
  expect(out80[1]).toContain('game-lead · 40 分')

  const longTitle = '這是一張標題非常非常長的待決卡用來測試單列清單項目過寬時以省略號截斷且時間固定在右邊界絕不換行'
  const cWide = con([card('d-aaaaaaaa', longTitle, 'PM', 2 * H)], [])
  for (const [cols, rows] of [[80, 24], [120, 30]] as const) {
    const rendered = decidePage.render(ctxOf(cols, rows, live(own80), cWide)).body
    const row = rendered.find(r => text(r).includes('d-aaaaaaaa'))!
    const raw = text(row)
    expect(displayWidth(raw)).toBe(cols)
    expect(raw).toContain('…')
    expect(raw.endsWith('2 時')).toBe(true)
  }
})

test('decide: option 6 of an old card, text mode and a held card draw their own action rows', () => {
  const wide = ctxOf(160, 40, live(own160), con([], []), nav({ textMode: true, textBuf: '先 12' })).valueOf() as never
  const o = decidePage.render(wide)
  expect(o.body.map(text).some(r => r.includes('補充   先 12_'))).toBe(true)
  expect(o.actions.map(text)).toEqual(['輸入補充中（數字字母都是文字）', 'Enter 存補充   [Esc] 放棄'])
  const held = decidePage.render(ctxOf(160, 40, live(own160), con([], []), nav({ picks: { 'd-89fe394f': 0 }, hold: { 'd-89fe394f': nowMs - 3500 } })))
  expect(held.actions.map(text)[0]).toBe('已送出 a  [u] 7 秒內撤回')
})

// ---- the key reducer: routeKey's page-local kinds, applied ----
const K = (key: string, n: DecideNav, c: unknown) => routeKey(key, { page: 'decide', paneFocus: true, focusedButton: false, textMode: n.textMode })
const press = (key: string, n: DecideNav, c: unknown, at = nowMs) => decideReduce(n, K(key, n, c), c as never, at)
const C160 = ctxOf(160, 40, live(own160, step160), con160)

test('decide keys: a-e pick an option of the focused card, a letter past its options does nothing, Enter sends once, u undoes inside 10 s only', () => {
  let r = press('c', NO_NAV, C160)
  expect(r.nav.picks).toEqual({})
  r = press('b', NO_NAV, C160)
  expect(r.nav.picks).toEqual({ 'd-89fe394f': 1 })
  const none = press('Enter', NO_NAV, C160)
  expect(none.effect).toBe(null)
  const sent = press('s', r.nav, C160)
  expect(sent.effect?.kind).toBe('send')
  expect((sent.effect as { line: string }).line.startsWith('d-89fe394f｜')).toBe(true)
  expect(sent.nav.hold).toEqual({ 'd-89fe394f': nowMs })
  expect(press('s', sent.nav, C160).effect).toBe(null) // already held: no second send
  expect(press('a', sent.nav, C160).nav.picks).toEqual({ 'd-89fe394f': 1 }) // a held card takes no pick
  const late = press('u', sent.nav, C160, nowMs + 10000)
  expect(late.effect).toBe(null)
  const undone = press('u', sent.nav, C160, nowMs + 4000)
  expect(undone.effect).toEqual({ kind: 'undo', id: 'd-89fe394f' })
  expect(undone.nav.hold).toEqual({})
})

test('decide keys: n opens the note mode; digits and letters are text until Enter saves or Esc drops; page digits win again after', () => {
  let n = press('n', NO_NAV, C160).nav
  expect(n.textMode).toBe(true)
  for (const ch of ['2', 'a', 'x']) n = press(ch, n, C160).nav
  expect(n.textBuf).toBe('2ax')
  expect(routeKey('2', { page: 'decide', paneFocus: true, focusedButton: false, textMode: true })).toEqual({ kind: 'text', ch: '2' })
  n = decideReduce(n, { kind: 'text', ch: 'Backspace' }, C160 as never, nowMs).nav
  expect(n.textBuf).toBe('2a')
  const saved = press('Enter', n, C160).nav
  expect(saved.textMode).toBe(false)
  expect(saved.notes).toEqual({ 'd-89fe394f': '2a' })
  const dropped = press('Escape', n, C160).nav
  expect(dropped.textMode).toBe(false)
  expect(dropped.notes).toEqual({})
  expect(routeKey('2', { page: 'decide', paneFocus: true, focusedButton: false, textMode: false }).kind).toBe('none') // outside text mode the page digit wins again; selecting the current page is idempotent
})

test('decide keys: h l move between cards (clamped), z folds, f fills the prompt without sending', () => {
  let n = press('l', NO_NAV, C160).nav
  expect(n.cursor).toBe(1)
  n = press('l', press('l', n, C160).nav, C160).nav
  expect(n.cursor).toBe(2)
  expect(press('h', n, C160).nav.cursor).toBe(1)
  expect(press('h', NO_NAV, C160).nav.cursor).toBe(0)
  expect(press('z', NO_NAV, C160).nav.folded).toBe(true)
  const f = press('f', NO_NAV, C160)
  expect(f.effect?.kind).toBe('fill')
  expect((f.effect as { text: string }).text.startsWith('[待決回覆]')).toBe(true)
  expect(f.nav.hold).toBe(undefined)
})

test('decide keys: an old 6-option card — j moves the focus to option 6, Enter picks it, a second Enter sends, k leaves; a-e never reach it', () => {
  const c = ctxOf(80, 24, live(old6), con([], []))
  expect(press('f', NO_NAV, c).effect).not.toBe(null) // sanity: fill works on this card
  let r = press('j', NO_NAV, c)
  expect(r.nav.opt).toBe(5)
  expect(press('j', r.nav, c).nav.opt).toBe(5)
  r = press('s', r.nav, c)
  expect(r.effect).toBe(null)
  expect(r.nav.picks).toEqual({ 'd-2b7710cc': 5 })
  const s = press('s', r.nav, c)
  expect(s.effect?.kind).toBe('send')
  expect(press('k', r.nav, c).nav.opt).toBe(null)
  expect(press('f', NO_NAV, c).nav.picks).toEqual({})
  expect(press('a', NO_NAV, c).nav.picks).toEqual({ 'd-2b7710cc': 0 })
  expect(press('j', NO_NAV, C160).nav.opt).toBe(null) // a card with 5 options or fewer has no option 6
})

// Changing this order needs the operator's confirmation first (PM 01M7PCAA).
test('decide card answer-area order is background < blocks < options < advice < note', () => {
  const fictional = dec({
    id: 'd-0a1b2c3d',
    question: '合成測試：發佈前要不要先跑回歸套件？',
    background: '合成背景：上一輪改動碰到排程邊界',
    blocks: '合成卡住：發佈流水線等待確認',
    options: opts('先跑回歸', '只跑冒煙', '跳過直接發'),
    recommendation: '先跑回歸：涵蓋排程邊界',
    source: 'fx-lane',
    age_s: AGE40,
  })
  const withNote = nav({ notes: { 'd-0a1b2c3d': '合成補充備註' } })
  for (const [cols, rows] of [[160, 40], [80, 24]] as const) {
    const out = frameRows(decidePage, ctxOf(cols, rows, live(fictional), con([], []), withNote)).map(text)
    const bg = out.findIndex(r => /^\s*背景\s/.test(r) && r.includes('合成背景'))
    const blocks = out.findIndex(r => /^\s*卡住\s/.test(r) && r.includes('合成卡住'))
    const opt = out.findIndex(r => r.includes('[a] 先跑回歸'))
    const optLast = out.findIndex(r => r.includes('[c] 跳過直接發'))
    const advice = out.findIndex(r => /^\s*建議\s/.test(r) && r.includes('涵蓋排程邊界'))
    const note = out.findIndex(r => /^\s*補充\s/.test(r) && r.includes('合成補充備註'))
    const indices = [bg, blocks, opt, advice, note]
    expect(indices.every(i => i >= 0)).toBe(true)
    expect(optLast >= opt && optLast < advice).toBe(true)
    for (let i = 1; i < indices.length; i++) expect(indices[i]).toBeGreaterThan(indices[i - 1])
  }
})
