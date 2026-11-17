// pages/now.test.ts — S3, page 1 現況 (r2 mockups 現況 at 160x40, 120x30, 80x24 and the 80x24 state variants). Golden = the page's content rows (header, blank filler, actions and strip
// stripped; the frame bottom-anchors the body where the mockup draws it top-anchored, so the blank rows between content and actions are not compared).
import { test, expect } from 'claude-code/testing'
import { frameRows, actionRows, staleBadge as frameBadge, brokenRow as frameBroken } from './frame'
import { nowPage, seatQuota, parseSeatQuota } from './now'
import { staleBadge, brokenRow } from './rows'
import { makeT } from '../i18n'
import type { ConsoleSnapshot } from '../console'

const t = makeT('zh-TW')
const NOW = 1794200000000
const MIN = 60_000
const text = (row: { text: string }[]): string => row.map(s => s.text).join('')

const con = (over: Partial<ConsoleSnapshot> = {}): ConsoleSnapshot => ({
  generated_at_ms: NOW - 12_000,
  sources: { hosts: { at_ms: NOW - 12_000, state: 'ok' }, tasks: { at_ms: NOW - 12_000, state: 'ok' } },
  counts: { decisions: 3, exceptions: 3, quota_risk: 1, tabs: {}, summary: { lines: { running: 6, waiting: 40, stalled: 5 }, hosts: { online: 17, total: 18 }, hints: 0, quota_worst: 'personal' } },
  items: [
    { id: 'e1', kind: 'exception', severity: 1, state: 'failed', needs_operator: true, title: 'capacity 卡住 2 時：等待沒寫等誰', text: 'capacity--claude 卡住 2 小時：等待沒寫等誰（wait_untyped）', since_ms: NOW - 120 * MIN, line_id: null, to_console: true, answerable_by: [] },
    { id: 'e2', kind: 'exception', severity: 2, state: 'stalled', needs_operator: true, title: 'hangar 01M7N2ZC 證據逾 40 分', text: 'hangar--claude 01M7N2ZC 證據逾期 40 分', since_ms: NOW - 40 * MIN, line_id: null, to_console: true, answerable_by: [] },
    { id: 'e3', kind: 'exception', severity: 3, state: 'need_you', needs_operator: true, title: '主機 h6 離線 12 分', text: '主機 h6 離線 12 分', since_ms: NOW - 12 * MIN, line_id: null, to_console: true, answerable_by: [] },
  ],
  cards: [{ id: 'd-aaaaaaaa', question: 'q', status: 'open', opened_at_ms: NOW - 40 * MIN, executor_display: null }],
  lines: [],
  quota: { pools: [{ pool: 'personal', limit_hit: true, stranded_seats: null, seven_day_pct: 100, five_hour_pct: 100, stale: false, observed_at_ms: NOW - 40_000 }], seats: [] },
  ...over,
} as ConsoleSnapshot)

const live = (over: Record<string, unknown> = {}): never => ({
  state: 'ok', text: '', header: '', band: null, pending: [], project_key: 'plan/shared-tui', root_run_id: null, link: null, rows: [{ stall: false, run_id: 'r1', role: 'hand', runner: 'sonnet', model: null, started_at: null, elapsed_s: 1380, phase: null }], gates: null,
  sections: { attention: null, attentionNotWired: false, tasks: { total: 3, completed: 1, in_progress: 1, current: '01M7N307 r2 草稿 03:00', first_created_ms: null, rows: [] }, tasksNote: null, decisionsNotWired: false, foreman: null },
  review: { plan: { logical_plan_id: null, generation: 1, max_generations: 2, terminal: false, verdict: null, seats: [{ id: 'a', family: null, status: 'done' }, { id: 'b', family: null, status: 'done' }], updated_at: null }, code: null },
  published_at: null, watcher_note: null, session_as_of: null, host_as_of: null,
  detail: { counts: { confirmed_live: 1, exited: 0, unknown: 0 }, stalled: 0, now_ms: null, project: 'plan/shared-tui', marker: { size: null, urgent: false, bug: false, high_risk: false, level: null, stage: 'plan', stage_set_at_ms: null, unit: null, review_families: [] }, qc: null, stage: null, decisions: null, load_source: null, residue: { reapable: 2, by_class: {}, at: null, needs_human_count: 0, needs_human_bytes: null, needs_human: [], auto_ran_at: null, auto_removed_count: null, auto_archived_count: null }, spend: { session: '$3.10', host_all: '', host_all_n: null, brain: null, cap: null, mode: '' } },
  metrics: { ctx: '41%' },
  activity: [{ kind: 'agent', label: '盤點子代理 4 分', detail: null, tail: null, quietMs: null }],
  recent: [{ id: '1', prompt: 'PM 01M7N33J 三條硬規定：分頁列在最下一列、高度固定、過期標紅', reply: '' }],
  ...over,
}) as never

const ctxOf = (cols: number, rows: number, c: ConsoleSnapshot | null, l: unknown = live()): never => ({ live: l, console: c, size: { cols, rows }, t, nowMs: NOW }) as never
const SEAT_JSON = JSON.stringify([{ seat: 'codeforge--claude', pool_key: 'team', five_hour_pct: 17.4, seven_day_pct: 68.2, stale: false, self: true }, { seat: 'x', pool_key: 'p', five_hour_pct: 1, seven_day_pct: 2, stale: false }])
const ok = (stdout: string) => async () => ({ exitCode: 0, stdout })
const fail = async () => ({ exitCode: 1, stdout: '' })

// the body rows of a framed page, text only, blank rows and the frame's own header/actions/strip removed
function content(cols: number, rows: number, c: ConsoleSnapshot | null, l: unknown = live()): string[] {
  const out = frameRows(nowPage, ctxOf(cols, rows, c, l)).map(text)
  const A = actionRows(rows)
  return out.slice(1, rows - 1 - A).map(r => r.trimEnd()).filter(r => r !== '')
}
const actionsOf = (cols: number, rows: number, c: ConsoleSnapshot | null, l: unknown = live()): string[] => nowPage.render(ctxOf(cols, rows, c, l)).actions.map(text)

const blocked = (stale: boolean) => ({ id: 'seat_blocked:twgame-2', kind: 'seat_blocked', severity: 1, state: 'failed', needs_operator: true, title: 'twgame-2 額度用完', text: 'twgame-2 額度用完：team 池 7 天用盡，週四 22:00 重置', since_ms: NOW - 5 * MIN, line_id: null, to_console: true, answerable_by: [], facts: { seat: 'twgame-2', pool: 'team', resets_at: NOW + 3600_000, source: 'statusline', window: '7d', resets_at_text: '週四 22:00', stale } })
const withItems = (extra: unknown[]) => con({ items: [...extra, ...con().items] as never })
const feed = async (): Promise<void> => { seatQuota.reset(); await seatQuota.refresh(ok(SEAT_JSON), NOW - 40_000) }

// the content rows of the mockup, row for row (the header and the mockup's top-anchored padding are the frame's; ✖ is the pane's ✗ glyph, ◈ the ⊘ stalled one)
const GOLD_160 = [
  '── 全艦隊 ────────────────────────────────────────────',
  '  產線 51 ｜ ● 執行 6  ⋯ 等待 40  ⊘ 卡住 5 ｜ 主機 17/18 在線 ｜ 額度 最緊 personal 已用完，換池資料無來源',
  '▸ ✗ capacity--claude 卡住 2 小時：等待沒寫等誰（wait_untyped）',
  '  ⊘ hangar--claude 01M7N2ZC 證據逾期 40 分',
  '  ▲ 主機 h6 離線 12 分',
  '── 本席 codeforge--claude ────────────────────────────',
  '  位置   plan/shared-tui · 階段 plan · ctx 41%',
  '  任務   ⋯ 01M7N307 r2 草稿 03:00 · 1/3',
  '  背景   ● 盤點子代理 4 分',
  '  派工   ● 1 執行中（sonnet hand 23 分）',
  '  審查   plan 第 1 代 2/2 席回來',
  '  花費   本席（池 team）5 小時 17% · 7 天 68% · 今天 $3.10（seats --quota 40 秒前）',
  '  殘留   2 項可清',
  '── 最近對話 ──────────────────────────────────────────',
  '  PM 01M7N33J 三條硬規定：分頁列在最下一列、高度固定、過期標紅',
]
const GOLD_120 = [GOLD_160[0], GOLD_160[1].replace(' ｜ 額度 最緊 personal 已用完，換池資料無來源', ''), '  額度   最緊 personal 已用完，換池資料無來源', ...GOLD_160.slice(2)]
const GOLD_80 = [
  '── 全艦隊 ──',
  '產線 51 ●6 ⋯40 ⊘5 · 主機 17/18 · 額度 ✗ personal 已用完，換池資料無來源',
  '▸✗ capacity 卡住 2 時：等待沒寫等誰',
  ' ⊘ hangar 01M7N2ZC 證據逾 40 分',
  ' ▲ 主機 h6 離線 12 分',
  '── 本席 codeforge ──',
  'plan/shared-tui · plan · ctx 41%',
  '⋯ 01M7N307 r2 草稿 03:00',
  '背景 ● 盤點子代理 4 分',
  '派工 ● 1 · 審查 2/2 · 花費 7 天 68%',
  '── 最近對話 ──',
  'PM 01M7N33J 三條硬規定：分頁列在最下一列、高度固定、過期標紅',
]
// compare rows after the right-aligned age column is collapsed (the age sits against the right edge; its text is checked apart)
const flat = (rows: string[]): string[] => rows.map(r => r.replace(/\s{2,}\d+ (秒|分|時|天)前$/, ''))
const diffRows = (got: string[], want: string[]): string[] => {
  const bad: string[] = []
  for (let i = 0; i < Math.max(got.length, want.length); i++) if (got[i] !== want[i]) bad.push(`#${i} got ${JSON.stringify(got[i])} want ${JSON.stringify(want[i])}`)
  return bad
}

test('now: golden at 160x40, 120x30 and 80x24 matches the mockup rows', async () => {
  await feed()
  expect(diffRows(flat(content(160, 40, con())), GOLD_160)).toEqual([])
  expect(diffRows(flat(content(120, 30, con())), GOLD_120)).toEqual([])
  expect(diffRows(flat(content(80, 24, con())), GOLD_80)).toEqual([])
  expect(content(160, 40, con())[2]).toMatch(/2 時前$/)
  expect(actionsOf(160, 40, con())).toEqual(['→ 待決 3 張卡等你（最舊 40 分）  [2]', '→ 殘留 2 項可清  [8]', '[Enter] 看焦點項'])
})

test('now: negative control, a broken golden row is reported (the comparator is not vacuous)', async () => {
  await feed()
  const broken = GOLD_80.slice()
  broken[2] = '▸✗ capacity 卡住 3 時：等待沒寫等誰'
  expect(diffRows(flat(content(80, 24, con())), broken).length).toBe(1)
})

test('now: frameRows is exactly H rows at every size and every state, actions never exceed A', async () => {
  await feed()
  const states: [string, ConsoleSnapshot | null, unknown][] = [
    ['console', con(), live()], ['no console', null, live()], ['no live', con(), null], ['neither', null, null], ['blocked', withItems([blocked(false)]), live()], ['blocked stale', withItems([blocked(true)]), live()],
    ['many exceptions', withItems(Array.from({ length: 30 }, (_, i) => ({ ...con().items[0], id: 'x' + i }))), live()],
    ['no pools', con({ quota: { pools: null, seats: [] } } as never), live()], ['empty pools', con({ quota: { pools: [], seats: [] } } as never), live()],
  ]
  const bad: string[] = []
  for (const [cols, rows] of [[160, 40], [120, 30], [80, 24]] as const)
    for (const [name, c, l] of states) {
      const ctx = ctxOf(cols, rows, c, l)
      if (frameRows(nowPage, ctx).length !== rows) bad.push(`${name}@${cols}x${rows} rows`)
      if (nowPage.render(ctx).actions.length > actionRows(rows)) bad.push(`${name}@${cols}x${rows} actions`)
    }
  expect(bad.join(' ')).toBe('')
})

test('now: null console and null live draw the no-source row, never throw', async () => {
  seatQuota.reset()
  const out = content(80, 24, null, null)
  expect(out.some(r => r.includes('無來源：沒有 console 資料'))).toBe(true)
  expect(out.some(r => r.includes('無來源：本席沒有 live 資料'))).toBe(true)
  const red = nowPage.render(ctxOf(80, 24, null, null)).body.flat().filter(s => s.text.includes('無來源'))
  expect(red.length).toBe(2)
  for (const s of red) expect(s.color).toBe(staleBadge('x').color)
})

test('now: overflow at 80x24 ends in the PgDn row and keeps 24 rows', async () => {
  await feed()
  const ex = Array.from({ length: 9 }, (_, i) => ({ ...con().items[0], id: 'e' + i, title: 'lane' + i + ' 卡住' }))
  const out = frameRows(nowPage, ctxOf(80, 24, con({ items: ex as never }))).map(text)
  expect(out.length).toBe(24)
  expect(out[24 - 2 - 4]).toContain('還有')
  expect(out[24 - 2 - 4]).toContain('PgDn')
})

test('now: a console seat shows the same body rows with a two minute old snapshot (the age is the frame header\'s)', async () => {
  await feed()
  const snap = con({ generated_at_ms: NOW - 2 * MIN, sources: { hosts: { at_ms: NOW - 2 * MIN, state: 'stale' }, tasks: { at_ms: NOW - 2 * MIN, state: 'stale' } } })
  expect(diffRows(flat(content(80, 24, snap)), GOLD_80)).toEqual([])
})

test('now: seat_blocked item is drawn from its text; stale=true is red with the source as the reason; none present adds nothing', async () => {
  await feed()
  const plainRows = content(160, 40, withItems([blocked(false)]))
  expect(plainRows[2]).toContain('twgame-2 額度用完：team 池 7 天用盡，週四 22:00 重置')
  expect(plainRows[2]).not.toContain('資料過期')
  const staleCtx = ctxOf(160, 40, withItems([blocked(true)]))
  const staleRow = nowPage.render(staleCtx).body.find(r => r.some(s => s.text.includes('twgame-2')))!
  const red = staleRow.find(s => s.text.includes('資料過期：statusline 沒在跑'))!
  expect(red.color).toBe(staleBadge('x').color)
  expect(red.text).toContain('twgame-2 額度用完：team 池 7 天用盡，週四 22:00 重置')
  expect(content(160, 40, con()).filter(r => r.includes('額度用完')).length).toBe(0)
  expect(diffRows(flat(content(160, 40, con())), GOLD_160)).toEqual([])
})

test('now: own-seat quota, command failure keeps the last result: yellow with the age, red after 10 minutes, no result is red', async () => {
  await feed()
  await seatQuota.refresh(fail, NOW + 61_000) // a failed run after the 60 s interval
  const at = (ms: number) => nowPage.render({ ...(ctxOf(160, 40, con()) as object), nowMs: ms } as never).body.flat().filter(s => s.text.includes('指令失敗'))
  const soon = at(NOW + 61_000)
  expect(soon.length).toBe(1)
  expect(soon[0].text).toContain('指令失敗，用 101 秒前的結果')
  expect(soon[0].color).toBe(nowPage.render(ctxOf(160, 40, con({ items: [{ ...blocked(false), kind: 'exception', to_console: true }] as never }))).body.length > 0 ? soon[0].color : undefined)
  expect(soon[0].color).not.toBe(staleBadge('x').color)
  const late = at(NOW - 40_000 + 11 * MIN)
  expect(late[0].color).toBe(staleBadge('x').color)
  seatQuota.reset()
  await seatQuota.refresh(fail, NOW)
  const none = nowPage.render(ctxOf(160, 40, con())).body.flat().find(s => s.text.includes('指令失敗'))!
  expect(none.color).toBe(staleBadge('x').color)
})

test('now: the feed asks once per 60 s, never twice at once, and parseSeatQuota refuses a foreign shape', async () => {
  seatQuota.reset()
  let calls = 0
  const run = async () => { calls++; return { exitCode: 0, stdout: SEAT_JSON } }
  expect(await seatQuota.refresh(run, NOW)).toBe(true)
  expect(await seatQuota.refresh(run, NOW + 30_000)).toBe(false)
  expect(await seatQuota.refresh(run, NOW + 61_000)).toBe(true)
  expect(calls).toBe(2)
  expect(parseSeatQuota('not json')).toBeNull()
  expect(parseSeatQuota('{"a":1}')).toBeNull()
})

test('now: the red marker equals frame.ts staleBadge / brokenRow', () => {
  expect(staleBadge('x')).toEqual(frameBadge('x'))
  expect(brokenRow('x')).toEqual(frameBroken('x'))
})

test('now: the quota line is worstPool\'s pool; a pace-less console with no pools says no source', async () => {
  await feed()
  const two = con({ quota: { pools: [{ pool: 'team', limit_hit: false, seven_day_pct: 50, stale: false, observed_at_ms: NOW }, { pool: 'personal', limit_hit: true, stranded_seats: null, seven_day_pct: 100, stale: false, observed_at_ms: NOW }] } } as never)
  expect(content(160, 40, two)[1]).toContain('personal')
  expect(content(160, 40, con({ quota: { pools: null, seats: [] } } as never))[1]).toContain('無來源：console 沒有 quota.pools')
})
