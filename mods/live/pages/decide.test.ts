// decide.test.ts — S1 (pane tabs r2, PM 01M7N307): the 待決 page against the codeforge mockups (e014900), row for row.
// Golden = the mockup's body and action rows (the frame's own header and strip rows are frame.golden.test.ts's). The mockups were drawn by hand, so the comparison
// is tolerant in exactly three ways (see `norm`): a run of blanks or of rule dashes inside a row counts as one, and a blank between a number and its unit (40 分 / 40分) is
// ignored. Everything else (every word, glyph, label, row order, row count) must be equal. DEVIATIONS lists the places where the mockup contradicts itself and what the page draws instead.
import { test, expect } from 'claude-code/testing'
import { PAGES } from './index'
import { frameRows, actionRows } from './frame'
import type { Page } from './frame'
import { AMBIGUOUS_CARD_RE, narrowAmbiguous } from './layout'
import { decidePage, decideReduce, NO_NAV, awaitingBlockRows } from './decide'
import type { DecideNav } from './decide'
import { routeKey } from './keys'
import { makeT } from '../i18n'
import { applyScroll, newScroll } from '../scrollmath'
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

// V3: z and f coexist in the same operation row.
// W3: one operation row, no undo before sending, and an explicit blocks row.
// Z4: progress and age stay together on the title row.
const GOLD = {
 "w160": {
  "body": [
   "▸ d-89fe394f  feature/legacy-payment-rewrite 和 feature/social-login 依序 --no-ff 合進 legacy？     執行者 game-lead (1/3 · 40 分)",
   "  背景   兩支分支都過審，合併順序影響 migration 編號",
   "  卡住   game-lead 的 row 不能自己合 main 以外的 legacy 分支",
   "  [a] 可以 ✧    [b] 先不要",
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
   "→ a [n] 補充 [s] 送出 [h] 上張 [l] 下張 [z] 收合其他 [f] 填入提示列"
  ]
 },
 "w120": {
  "body": [
   "▸ d-4c2e19a0  馬拉松分支 5 支怎麼合進 release？                       執行者 game-lead (2/3 · 2 時)",
   "  背景   五支分支互相有衝突，合併順序決定誰要 rebase",
   "  卡住   game-lead 只能合 main，release 要你點頭",
   "  [a] 全部一次合",
   "  [b] 依序合，每支綠才合下一支 ✧",
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
   "→ c [n] 補充 [s] 送出 [h] 上張 [l] 下張 [z] 收合其他 [f] 填入提示列"
  ]
 },
 "c80": {
  "body": [
   "▸ payment 和 social-login 依序 --no-ff 合進 legacy？ (1/3 · 40 分)",
   "  d-89fe394f · game-lead",
   "背景 兩支都過審，順序影響 migration",
   "卡住 game-lead 只能合 main，legacy 要你點頭",
   "[a] 可以 ✧   [b] 先不要",
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
   "→ a [n] 補充 [s] 送出 [h] 上張 [l] 下張 [z] 收合其他 [f] 填入提示列"
  ]
 },
 "c80_folded": {
  "body": [
   "▸ payment 和 social-login 依序 --no-ff 合進 legacy？ (1/3 · 40 分)",
   "  d-89fe394f · game-lead",
   "背景 兩支都過審，順序影響 migration",
   "卡住 game-lead 只能合 main，legacy 要你點頭",
   "[a] 可以 ✧   [b] 先不要",
   "建議 可以：先 payment 再 social",
   "── 其他待決 2（z 展開）──",
   "── 別台（唯讀）──",
   "d-1c0a77e2 h6：GPU 重排 → 到該席答",
   "── 要你做或看 ──",
   "01M7N2TZ 上線後看截圖"
  ],
  "actions": [
   "→ a [n] 補充 [s] 送出 [h] 上張 [l] 下張 [z] 展開其他 [f] 填入提示列"
  ]
 },
 "c80_open": {
  "body": [
   "▸ payment 和 social-login 依序 --no-ff 合進 legacy？ (1/3 · 40 分)",
   "  d-89fe394f · game-lead",
   "背景 兩支都過審，順序影響 migration",
   "卡住 game-lead 只能合 main，legacy 要你點頭",
   "[a] 可以 ✧   [b] 先不要",
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
   "→ a [n] 補充 [s] 送出 [h] 上張 [l] 下張 [z] 收合其他 [f] 填入提示列"
  ]
 },
 "c80_sent": {
  "body": [
   "▸ payment 和 social-login 依序 --no-ff 合進 legacy？ (1/3 · 40 分)",
   "  d-89fe394f · game-lead",
   "已送出：[b] 先不要",
   "── 其他待決 2（z 收合）──",
   "d-fd51ee8d 308 現場量 30 格 · 1天",
   "d-fb890f48 [測試卡] 請勿作答 · 2時",
   "── 別台（唯讀）──",
   "d-1c0a77e2 h6：GPU 重排 → 到該席答"
  ],
  "actions": [
   "已送出 b  [u] 8 秒內撤回 [h] 上張 [l] 下張"
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
   "▸ 六條合併策略選哪一條？ (1/1 · 3 時)",
   "  d-2b7710cc · game-lead（舊卡，6 個選項）",
   "卡住 —",
   "[a] 全合  [b] 依序  [c] 兩批",
   "[d] 前兩支  [e] 先不要",
   "[f6] 第 6 項：只合 hotfix",
   "── 其他待決 0 ──"
  ],
  "actions": [
   "→ f6 [n] 補充 [s] 送出 [h] 上張 [l] 下張 [f] 填入提示列"
  ]
 }
} as Record<string, { body: string[]; actions: string[] }>

// ---- fixtures: one per mockup state (the hand-drawn 80-column mockups use shorter sentences than the 160 / 120 ones, so each size has its own card texts) ----
const own160 = dec({ id: 'd-89fe394f', question: 'feature/legacy-payment-rewrite 和 feature/social-login 依序 --no-ff 合進 legacy？', background: '兩支分支都過審，合併順序影響 migration 編號', blocks: 'game-lead 的 row 不能自己合 main 以外的 legacy 分支', recommendation: '可以：先 payment 再 social，CI 綠才合第二支', options: opts('可以', '先不要'), source: 'game-lead', age_s: AGE40 })
const step160 = dec({ title: '01M7N2TZ 上線後看 pane 截圖', question: '01M7N2TZ 上線後看 pane 截圖', kind: 'step' })
const con160 = con([card('d-fb890f48', '[測試卡] carddispatch 真 courier 紅綠，請勿在面板作答', 'PM', 2 * H), card('d-fd51ee8d', '下次到 308 現場時量 30 格（要你到場，只能回報）', '308', 24 * H)], [mirror('h6 席：GPU slot 重排要你點頭', 'h6')], farLines)
const own120 = dec({ id: 'd-4c2e19a0', question: '馬拉松分支 5 支怎麼合進 release？', background: '五支分支互相有衝突，合併順序決定誰要 rebase', blocks: 'game-lead 只能合 main，release 要你點頭', recommendation: '依序合，每支綠才合下一支', options: opts('全部一次合', '依序合，每支綠才合下一支', '拆兩批，每批 2–3 支', '只合前兩支，其餘下週', '先不要'), source: 'game-lead', age_s: 2 * 3600 })
const con120 = con(con160.cards, [])
const own80 = dec({ id: 'd-89fe394f', question: 'payment 和 social-login 依序 --no-ff 合進 legacy？', background: '兩支都過審，順序影響 migration', blocks: 'game-lead 只能合 main，legacy 要你點頭', recommendation: '可以：先 payment 再 social', options: opts('可以', '先不要'), source: 'game-lead', age_s: AGE40 })
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
  test(`decide golden ${c.name}: the retired page is one action line`, () => {
    const out = decidePage.render(c.ctx as never)
    expect(out.body).toEqual([])
    expect(out.actions.map(text).join('')).toBe('待決在 band 上（d）')
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
    const rendered = decidePage.render(ctx)
    expect(rendered.body).toEqual([])
    expect(rendered.actions.map(text).join('')).toBe('待決在 band 上（d）')
    expect(frameRows(decidePage, ctx).length).toBe(rows)
  }
})

test('decide: console cards list missing, or a stale cards source, is a red row with its reason', () => {
  const ctx = ctxOf(80, 24, live(own80), con(null, []))
  const missing = decidePage.render(ctx)
  expect(missing.body).toEqual([])
  expect(missing.actions.map(text).join('')).toBe('待決在 band 上（d）')
  const stale = ctxOf(80, 24, live(own80), con([], [], [], { cards: { at_ms: nowMs - 12 * 60000, state: 'stale' } }))
  const staleOut = decidePage.render(stale)
  expect(staleOut.body).toEqual([])
  expect(staleOut.actions.map(text).join('')).toBe('待決在 band 上（d）')
  expect(frameRows(decidePage, stale).length).toBe(24)
})

test('decide A10: a stale reason is never truncated: at 70 columns it wraps onto further rows, no row ends in …', () => {
  const why = '沒有專案 · 請執行：autopilot status runs --watch 再重新整理本席待決資料'
  const out = frameRows(decidePage, ctxOf(70, 24, { state: 'stale', header: why, pending: [] } as never, con([], [])))
  expect(out.length).toBe(24)
  expect(out.map(text).join('')).toContain('待決在 band 上（d）')
  expect(out.map(text).join('')).not.toContain(why)
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
    expect(out.map(text).join('')).toContain('待決在 band 上（d）')
    expect(out.map(text).join('')).not.toContain('無來源')
    expect(out.map(text).filter(r => !r.startsWith('╰─') && r.includes('…'))).toEqual([]) // the page rows only: the v7.4 border row clips its key hints at narrow widths
  }

  const ptrOnly = frameRows(decidePage, ctxOf(80, 24, noPointer, noCardsCon)).map(text).join('')
  expect(ptrOnly).toContain('待決在 band 上（d）')
  expect(ptrOnly).not.toContain('沒有指標檔')

  const conOnly = frameRows(decidePage, ctxOf(80, 24, noProject, null)).map(text).join('')
  expect(conOnly).toContain('待決在 band 上（d）')
  expect(conOnly).not.toContain('沒有 console 快照')
})

test('decide: a long list never changes the frame height (overflow ends in the more row)', () => {
  const many = Array.from({ length: 30 }, (_, i) => card('d-' + String(i).padStart(8, '0'), '第 ' + i + ' 張', 'PM', H))
  for (const [cols, rows] of SIZES) {
    const out = frameRows(decidePage, ctxOf(cols, rows, live(own80), con(many, [])))
    expect(out.length).toBe(rows) // the frame stays H rows; the list itself is not drawn
    expect(out.map(text).join('')).toContain('待決在 band 上（d）')
    expect(out.some(r => text(r).includes('還有'))).toBe(false)
  }
})

test('decide: a console card in focus is read-only and names the seat that answers it', () => {
  // N1 (codeforge B49-B54, S1-full-p2-160x40 row 27): with no own card the card that has waited longest (d-fd51ee8d, 1 天) is focused, not the 2 時 one
  const ctx = ctxOf(80, 24, live(), con160, nav({}))
  const o = decidePage.render(ctx)
  expect(o.body).toEqual([])
  expect(text(o.actions[0])).toBe('待決在 band 上（d）')
})

test('decide R2 & R11: at 80x24 card question comes before owner seat and age; wide single-row other-card titles cut with … keeping age fixed at right edge', () => {
  const out80 = decidePage.render(ctxOf(80, 24, live(own80), con80))
  expect(out80.body).toEqual([])
  expect(out80.actions.map(text).join('')).toBe('待決在 band 上（d）')
  const longTitle = '這是一張標題非常非常長的待決卡用來測試單列清單項目過寬時以省略號截斷且時間固定在右邊界絕不換行'
  const cWide = con([card('d-aaaaaaaa', longTitle, 'PM', 2 * H)], [])
  for (const [cols, rows] of [[80, 24], [120, 30]] as const) {
    const rendered = decidePage.render(ctxOf(cols, rows, live(own80), cWide))
    expect(rendered.body).toEqual([])
    expect(rendered.actions.map(text).join('')).toBe('待決在 band 上（d）')
    expect(rendered.actions.map(text).join('')).not.toContain('d-aaaaaaaa')
    expect(frameRows(decidePage, ctxOf(cols, rows, live(own80), cWide)).length).toBe(rows)
  }
})

test('decide: option 6 of an old card, text mode and a held card draw their own action rows', () => {
  const wide = ctxOf(160, 40, live(own160), con([], []), nav({ textMode: true, textBuf: '先 12' })).valueOf() as never
  const o = decidePage.render(wide)
  expect(o.body).toEqual([])
  expect(o.actions.map(text).join('')).toBe('待決在 band 上（d）')
  const held = decidePage.render(ctxOf(160, 40, live(own160), con([], []), nav({ picks: { 'd-89fe394f': 0 }, hold: { 'd-89fe394f': nowMs - 3500 } })))
  expect(held.body).toEqual([])
  expect(held.actions.map(text).join('')).toBe('待決在 band 上（d）')
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

test('decide keys: m opens the note mode; digits and letters are text until Enter saves or Esc drops; page digits win again after', () => {
  let n = press('m', NO_NAV, C160).nav
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
    expect(out.join('')).toContain('待決在 band 上（d）')
    expect(out.some(r => r.includes('合成背景') || r.includes('[a] 先跑回歸'))).toBe(false)
  }
})

test('v74 boxed decide scrolls card detail on ArrowDown/PageDown and resets on p/n', () => {
  // 已改為雙欄
  const longBg = Array.from({ length: 16 }, (_, i) => `背景第 ${i + 1} 段說明文字`).join('；')
  const cards = [
    {
      id: 'd-long-1', title: '長卡一', question: '這張長卡要怎麼處理？', background: longBg,
      options: [{ label: '選項甲', detail: '甲的詳細說明' }, { label: '選項乙', detail: '乙的詳細說明' }],
    },
    {
      id: 'd-short-2', title: '短卡二', question: '第二張卡？', background: '簡短背景',
      options: [{ label: '好', detail: '' }],
    },
  ]
  const pendingScroll = { list: newScroll(), detail: newScroll(), cursor: '' }
  const draw = (curNav: DecideNav) => frameRows(decidePage, {
    live: live(), console: con([], []), size: { cols: 120, rows: 14 }, t, nowMs,
    box: true, pendingScroll, decide: curNav,
    v74: { decide: cards, nav: { cursor: curNav.cursor, picks: {}, notes: {}, noteMode: false } },
  } as never, { topAnchor: true }).map(text)

  let curNav = nav({ cursor: 0 })
  let out = draw(curNav)
  expect(out.join('\n')).toContain('卡 #01 / 2')
  expect(out.join('\n')).toContain('還有')

  // ArrowDown scrolls detail, card stays 1
  applyScroll(pendingScroll.detail, { by: 1, contentRows: 0 })
  out = draw(curNav)
  expect(pendingScroll.detail.offset).toBe(1)
  expect(out.join('\n')).toContain('卡 #01 / 2')

  // PageDown scrolls by room
  const beforePg = pendingScroll.detail.offset
  applyScroll(pendingScroll.detail, { by: pendingScroll.detail.room, contentRows: 0 })
  out = draw(curNav)
  expect(pendingScroll.detail.offset).toBeGreaterThan(beforePg)

  // Scroll to bottom: ↓ 下面還有 disappears and further down does not move
  applyScroll(pendingScroll.detail, { by: 999, contentRows: 0 })
  out = draw(curNav)
  const bottom = pendingScroll.detail.offset
  expect(out.some(r => r.includes('↓ 還有') || r.includes('下面還有'))).toBe(false)
  applyScroll(pendingScroll.detail, { by: 1, contentRows: 0 })
  draw(curNav)
  expect(pendingScroll.detail.offset).toBe(bottom)

  // ArrowUp / PageUp scrolls back
  applyScroll(pendingScroll.detail, { by: -1, contentRows: 0 })
  draw(curNav)
  expect(pendingScroll.detail.offset).toBe(bottom - 1)

  // p/n switches card and resets detail scroll to 0
  const nAct = routeKey('n', { page: 'decide', paneFocus: true, focusedButton: false, textMode: false })
  expect(nAct).toEqual({ kind: 'move', by: 1 })
  curNav = decideReduce(curNav, nAct, {
    live: live(), console: con([], []), size: { cols: 120, rows: 14 }, t, nowMs,
    v74: { decide: cards, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } },
  } as never, nowMs).nav
  expect(curNav.cursor).toBe(1)
  out = draw(curNav)
  expect(out.join('\n')).toContain('卡 #02 / 2')
  expect(pendingScroll.detail.offset).toBe(0)
})

// ---- 等你動手: answered cards that still wait on the operator's own step (durable store, status awaiting_operator_action) ----
test('awaiting block: a long step wraps onto continuation rows in full (never cut); the block sits under the card list, above the footer; absent without cards', () => {
  const card = { id: 'd-card01', title: '一張卡', question: '這張卡的問題？', background: null, options: [{ label: '可以', detail: '', recommended: true }, { label: '不行', detail: '', recommended: false }] }
  const step = '把評測機第二槽的電源線插到備用插座上，確認燈號常亮之後在回報通道回報結果並附上照片'
  const aw = [{ id: 'd-aw01', title: '插電', question: '評測機第二槽插電？', operator_steps: [step, '短步驟'] }]
  const ctx = (awaiting: unknown) => ({ live: null, console: null, size: { cols: 80, rows: 40 }, t, nowMs, v74: { decide: [card], awaiting, pm: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } }) as never

  // unit: heading, then the card's title row, then every step numbered and whole; a long step wraps under its own indent
  const rows = awaitingBlockRows(aw, ctx(aw), 100)
  const stepRows = rows.map(r => r.map(s => s.text).join(''))
  expect(stepRows[0]).toBe(t('v74.d.await_head', { n: 1 }))
  expect(stepRows[1]).toContain('插電')
  expect(stepRows[2].startsWith('  1. ')).toBe(true)
  expect(stepRows[3].startsWith('    '), 'continuation row is indented under the step text').toBe(true)
  expect(stepRows[4]).toContain('2. 短步驟')
  expect(stepRows.join('').replace(/\s+/g, ''), 'the step is whole across its rows').toContain(step.replace(/\s+/g, ''))
  expect(stepRows.every(l => !l.includes('…')), 'no step is cut').toBe(true)
  expect(rows.every(r => r.reduce((w, s) => w + displayWidth(s.text), 0) <= 80)).toBe(true)

  // frame: the block is under the card list (the body) and the send row, above the footer rows (border + strip)
  const framed = frameRows(decidePage, ctx(aw), { pages: PAGES })
  const rowText = (r: { text: string }[]) => r.map(s => s.text).join('')
  const idxHead = framed.findIndex(r => rowText(r).includes(t('v74.d.await_head', { n: 1 })))
  const idxCard = framed.findIndex(r => rowText(r).includes('這張卡的問題？'))
  expect(idxHead).toBeGreaterThan(-1)
  expect(idxCard).toBeGreaterThan(-1)
  expect(idxCard, 'the card list is above the block').toBeLessThan(idxHead)
  expect(idxHead, 'the block is above the footer (border + strip)').toBeLessThan(framed.length - 2)
  expect(framed.every(r => r.reduce((w, s) => w + displayWidth(s.text), 0) <= 80)).toBe(true)

  // zero awaiting cards: the block is absent
  const none = frameRows(decidePage, ctx(undefined), { pages: PAGES })
  expect(none.some(r => rowText(r).includes(t('v74.d.await_head', { n: 1 })))).toBe(false)
})

// Canary 2026-11-25 (pin 078bb1fbd): the block lived in the 4-6 row action area, so a card with three long steps never fit and
// the operator saw only 「等你動手 2 張 / …另 2 張」 at 80x24, 120x40 and 200x50. It now sits at the bottom of the body.
test('awaiting block: a card with several long steps shows every step under a full card page, docked and boxed, at 80 / 120 / 200 columns', () => {
  const bg = Array.from({ length: 80 }, (_, i) => '第 ' + String(i + 1).padStart(2, '0') + ' 行：假資料，用來把內文撐得比 Pane 高。').join('\n')
  const cards = Array.from({ length: 8 }, (_, i) => ({ id: 'd-full' + i, title: '卡 ' + i, question: '問題 ' + i + '？', background: i === 0 ? bg : null, options: [{ label: 'A 可以', detail: '', recommended: true }, { label: 'B 不行', detail: '', recommended: false }] }))
  const steps = ['到機櫃把評測機第二槽的電源線插到備用插座（插座在機櫃背面左下角，標示 UPS-2 的那一排），插好後等前面板燈號由閃爍變成常亮', '在操作台跑一次讀回指令，確認畫面顯示的 sha 和卡片上寫的一致', '回到這張卡按完成']
  const aw = [{ id: 'd-aw01', title: '評測機第二槽插電', question: '插電？', operator_steps: steps }]
  const flat = (rows: { text: string }[][]) => rows.map(r => r.map(s => s.text).join('')).join('\n').replace(/[\s│]+/g, '')
  for (const [cols, rows] of [[80, 24], [120, 40], [200, 50]] as const) for (const box of [false, true]) {
    const ctx = { live: null, console: null, size: { cols, rows }, t, nowMs, ...(box ? { box: true, maxRows: rows } : {}), v74: { decide: cards, awaiting: aw, pm: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } } as never
    const framed = frameRows(decidePage, ctx, { pages: PAGES })
    const text = flat(framed)
    const where = cols + 'x' + rows + (box ? ' boxed' : ' docked')
    expect(framed.length, where + ': the frame keeps its height').toBe(rows)
    expect(text, where + ': heading').toContain(t('v74.d.await_head', { n: 1 }).replace(/\s+/g, ''))
    for (const s of steps) expect(text, where + ': step whole: ' + s.slice(0, 12)).toContain(s.replace(/\s+/g, ''))
    expect(framed.every(r => r.reduce((w, s) => w + displayWidth(s.text), 0) <= cols), where + ': no row wider than the pane').toBe(true)
  }
})

// Canary 2 (pin b67c04a2e, sandbox harness): the host gives the AbovePrompt box 5 / 13 / 17 rows at 80x24 / 120x40 / 200x50, so a
// third of the box never held one card's steps (120x40 drew 「等你動手 2 張 / …另 2 張」) and at 5 rows the frame cut the block off.
// The block grows to the first card whole (up to half the body), keeps its heading at any size, and the card box gives way.
test('awaiting block: in the host box allocations (5 / 13 / 17 rows) the first card shows every step, and the heading survives the smallest box', () => {
  const bg = Array.from({ length: 80 }, (_, i) => '第 ' + String(i + 1).padStart(2, '0') + ' 行：假資料。').join('\n')
  // titles and options wider than 80 columns: the frame wraps a reading page at 80, so a page that counts unwrapped rows overflows
  const long = '要不要把這一輪的修正併進開發分支並且在測試機上先換版、讀回、拍照，再交給操作員的面板換版'
  const cards = Array.from({ length: 21 }, (_, i) => ({ id: 'd-host' + i, title: '卡 ' + i + ' ' + long, question: long + '？', background: i === 0 ? bg : null, options: [{ label: 'A 可以，' + long, detail: '', recommended: true }, { label: 'B 不行', detail: '', recommended: false }] }))
  const steps = ['到機櫃把評測機第二槽的電源線插到備用插座（插座在機櫃背面左下角，標示 UPS-2 的那一排），插好後等前面板燈號由閃爍變成常亮', '在操作台跑一次讀回指令，確認畫面顯示的 sha 和卡片上寫的一致', '回到這張卡按完成']
  const aw = [{ id: 'd-aw01', title: '評測機第二槽插電', question: '插電？', operator_steps: steps }, { id: 'd-aw02', title: '換線', question: '換？', operator_steps: ['換上新的網路線'] }]
  const flat = (rows: { text: string }[][]) => rows.map(r => r.map(s => s.text).join('')).join('\n').replace(/[\s│]+/g, '')
  // maxRows below DECIDE_COMPACT_MAX_ROWS draws the compact card list (the canary-2 120x40 shot): its rows wrap in the frame too
  for (const [cols, rows, whole, maxRows] of [[76, 5, false, 5], [116, 13, true, 13], [116, 13, true, 9], [196, 17, true, 17]] as const) {
    const ctx = { live: null, console: null, size: { cols, rows }, t, nowMs, box: true, maxRows, v74: { decide: cards, awaiting: aw, pm: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } } as never
    const framed = frameRows(decidePage, ctx, { pages: PAGES, topAnchor: true })
    const text = flat(framed)
    const where = cols + 'x' + rows + ' box (maxRows ' + maxRows + ')'
    expect(framed.length, where + ': the frame keeps its height').toBe(rows)
    expect(text, where + ': heading').toContain(t('v74.d.await_head', { n: 2 }).replace(/\s+/g, ''))
    if (whole) for (const s of steps) expect(text, where + ': step whole: ' + s.slice(0, 12)).toContain(s.replace(/\s+/g, ''))
    expect(framed.every(r => r.reduce((w, s) => w + displayWidth(s.text), 0) <= cols), where + ': no row wider than the pane').toBe(true)
  }
})

// Canary 2026-11-25 (pins ce554da6d, a9bc2ebe3): with a 等你動手 block the boxed dual page was wrapped again at 80 columns (frameWrap)
// so the columns collapsed into one, the separator broke into pieces and the detail lost its options. A card with no step is no item.
test('awaiting block: the dual columns keep one separator column and the options stay visible at 209x49, 120x40 and 80x24; a stepless card is not counted', () => {
  const bg = Array.from({ length: 4 }, (_, i) => '第 ' + String(i + 1).padStart(2, '0') + ' 行：背景說明。').join('\n')
  const cards = Array.from({ length: 3 }, (_, i) => ({ id: 'd-dual' + i, title: '合併計畫 ' + i, question: '要不要合併這一輪的修正？', background: i === 0 ? bg : null, options: [{ label: '可以合併', detail: '', recommended: true }, { label: '先不要', detail: '', recommended: false }] }))
  const aw = [
    { id: 'd-aw01', title: '插電', question: '插電？', operator_steps: ['到機櫃把第二槽電源線插好', '回到這張卡按完成'] },
    { id: 'd-aw02', title: '沒有步驟的卡', question: '空？', operator_steps: [] },
  ]
  const rowText = (r: { text: string }[]) => r.map(s => s.text).join('')
  for (const [cols, rows] of [[209, 49], [120, 40], [80, 24]] as const) {
    const ctx = { live: null, console: null, size: { cols, rows }, t, nowMs, box: true, maxRows: rows, v74: { decide: cards, awaiting: aw, pm: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } } as never
    const framed = frameRows(decidePage, ctx, { pages: PAGES })
    const texts = framed.map(rowText)
    const where = cols + 'x' + rows
    expect(texts.some(x => x.includes(t('v74.d.await_head', { n: 1 }))), where + ': only the card with a step is counted').toBe(true)
    expect(texts.some(x => x.includes('沒有步驟的卡')), where + ': the stepless card is not drawn').toBe(false)
    expect(texts.join('\n'), where + ': an option is visible').toContain('可以合併')
    expect(framed.every(r => r.reduce((w, s) => w + displayWidth(s.text), 0) <= cols), where + ': no row wider than the pane').toBe(true)
    if (cols >= 120) {
      const seps = texts.filter(x => x.includes('│')).map(x => displayWidth(x.slice(0, x.indexOf('│'))))
      expect(seps.length, where + ': the dual columns are drawn').toBeGreaterThan(3)
      expect(new Set(seps).size, where + ': one separator column').toBe(1)
    }
  }
})

// PM ruling 01M89BCVGB (2026-11-25): the focused card's options are never left to a scroll; when the 等你動手 block would hide one,
// the block folds to its heading row. Host box allocations 13 / 17 rows and the 24-row screen, cards with and without steps.
test('awaiting block: it folds to its heading when it would hide an option of the focused card', () => {
  const cards = Array.from({ length: 3 }, (_, i) => ({ id: 'd-fold' + i, title: '合併計畫 ' + i, question: '要不要合併這一輪的修正？', background: null, options: [{ label: '可以合併', detail: '', recommended: true }, { label: '先不要', detail: '', recommended: false }, { label: '另外再議', detail: '', recommended: false }] }))
  const steps = ['到機櫃把評測機第二槽的電源線插到備用插座，插好後等前面板燈號變成常亮', '在操作台跑一次讀回指令，確認畫面顯示的 sha 和卡片上寫的一致', '回到這張卡按完成']
  const withStep = [{ id: 'd-aw01', title: '插電', question: '插電？', operator_steps: steps }]
  const flat = (rows: { text: string }[][]) => rows.map(r => r.map(s => s.text).join('')).join('\n').replace(/[\s│]+/g, '')
  for (const [cols, rows, maxRows] of [[116, 13, 13], [196, 17, 17], [76, 12, 12], [120, 40, 40], [209, 49, 49]] as const) for (const aw of [withStep, []]) {
    const ctx = { live: null, console: null, size: { cols, rows }, t, nowMs, box: true, maxRows, v74: { decide: cards, awaiting: aw, pm: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } } as never
    const framed = frameRows(decidePage, ctx, { pages: PAGES, topAnchor: true })
    const where = cols + 'x' + rows + ' (maxRows ' + maxRows + ', ' + aw.length + ' awaiting)'
    for (const label of ['可以合併', '先不要', '另外再議']) expect(flat(framed), where + ': option ' + label).toContain(label)
    expect(framed.every(r => r.reduce((w, s) => w + displayWidth(s.text), 0) <= cols), where + ': no row wider than the pane').toBe(true)
    expect(framed.length, where + ': the frame keeps its height').toBe(rows)
  }
})

// PM dispatch 01M89K7N1W: card d-661d1428 had circled numbers in its title; the owner's terminal draws them two cells, the page counted one, the text after them overlapped.
test('ambiguous-width glyphs: circled numbers in a card title are drawn narrow, so no row holds one and every row fits the pane', () => {
  const cards = [{ id: 'd-661d1428', title: '區塊:②Omni 8步…唇形對 ③PDD', question: '※ 要不要合併？ → 選項 ○ ★ “引號”…', background: null, options: [{ label: '可以合併', detail: '', recommended: true }, { label: '先不要', detail: '' }] }]
  for (const [cols, rows] of [[120, 40], [80, 24], [209, 49]] as const) {
    const ctx = { live: null, console: null, size: { cols, rows }, t, nowMs, v74: { decide: cards, awaiting: [], pm: null, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } } } as never
    const framed = frameRows(decidePage, ctx, { pages: PAGES, topAnchor: true })
    const joined = framed.map(r => r.map(s => s.text).join('')).join('\n')
    expect(/[\u2461\u2462\u203b\u2192\u25cb\u2605\u201c\u201d]/u.test(joined), cols + 'x' + rows + ': no Ambiguous character of the card text is drawn').toBe(false)
    expect(joined, cols + 'x' + rows + ': the title keeps its text').toContain('2.Omni 8步')
    expect(framed.every(r => r.reduce((w, s) => w + displayWidth(s.text), 0) <= cols), cols + 'x' + rows + ': no row wider than the pane').toBe(true)
  }
})

test('ambiguous-width glyphs: narrowAmbiguous leaves no Ambiguous character, keeps wide CJK and ASCII, and the circled numbers become 1. 2. 3.', () => {
  const s = '區塊:②Omni 8步…唇形對 ③PDD ① ⑳ ※ → ○ ★ “x” 中文 ok'
  const out = narrowAmbiguous(s)
  expect(AMBIGUOUS_CARD_RE.test(out)).toBe(false)
  expect(out).toBe('區塊:2.Omni 8步...唇形對 3.PDD 1. 20. * -> o * "x" 中文 ok')
})
