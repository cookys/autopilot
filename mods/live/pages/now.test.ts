// pages/now.test.ts — S3, page 1 現況 (r2 mockups 現況 at 160x40, 120x30, 80x24 and the 80x24 state variants). Golden = the page's content rows (header, blank filler, actions and strip
// stripped; the frame bottom-anchors the body where the mockup draws it top-anchored, so the blank rows between content and actions are not compared).
import { test, expect } from 'claude-code/testing'
import { PAGES } from './index'
import { FOCUS_ANCHOR_KEY, Pane } from '../pane'
import { frameRows, actionRows, staleBadge as frameBadge, brokenRow as frameBroken } from './frame'
import { nowPage, seatQuota, parseSeatQuota } from './now'
import { staleBadge, brokenRow } from './rows'
import { makeT } from '../i18n'
import { displayWidth } from '../model'
import { PALETTE } from '../ui'
import { renderQuota } from './quota'
import { poolKey, poolLabel } from './quota-pick'
import { POOLS, consoleOf } from './quota.fixture'
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
  const A = nowPage.render(ctxOf(cols, rows, c, l)).actions.length
  return out.slice(1, out.length - 1 - A).map(r => r.trimEnd()).filter(r => r !== '')
}
const actionsOf = (cols: number, rows: number, c: ConsoleSnapshot | null, l: unknown = live()): string[] => nowPage.render(ctxOf(cols, rows, c, l)).actions.map(text)

const blocked = (stale: boolean) => ({ id: 'seat_blocked:twgame-2', kind: 'seat_blocked', severity: 1, state: 'failed', needs_operator: true, title: 'twgame-2 額度用完', text: 'twgame-2 額度用完：team 池 7 天用盡，週四 22:00 重置', since_ms: NOW - 5 * MIN, line_id: null, to_console: true, answerable_by: [], facts: { seat: 'twgame-2', pool: 'team', resets_at: NOW + 3600_000, source: 'statusline', window: '7d', resets_at_text: '週四 22:00', stale } })
const withItems = (extra: unknown[]) => con({ items: [...extra, ...con().items] as never })
const feed = async (): Promise<void> => { seatQuota.reset(); await seatQuota.refresh(ok(SEAT_JSON), NOW - 40_000) }

// the content rows of the mockup, row for row (the header and the mockup's top-anchored padding are the frame's; ✖ is the pane's ✗ glyph, ◈ the ⊘ stalled one)
const GOLD_160 = [
  '→ 待決 3 張卡等你（最舊 40 分）：q',
  '── 全艦隊 ────────────────────────────────────────────',
  '  產線 51 ｜ ● 執行 6  ⋯ 等待 40  ⊘ 卡住 5 ｜ 主機 17/18 在線',
  '▸ ✗ capacity--claude 卡住 2 小時：等待沒寫等誰（wait_untyped）',
  '  ⊘ hangar--claude 01M7N2ZC 證據逾期 40 分',
  '  ▲ 主機 h6 離線 12 分',
  '  ? 額度 personal 判定未知：缺換池資料（capacity）',
  '── 本席 codeforge--claude ────────────────────────────',
  '  位置   plan/shared-tui · 階段 plan · ctx 41%',
  '  任務   ⋯ 01M7N307 r2 草稿 03:00 · 1/3',
  '  背景   ● 盤點子代理 4 分',
  '  派工   ● 1 執行中（sonnet hand 23 分）',
  '  審查   plan 第 1 代 2/2 席回來',
  '  花費   本席（池 team）5 時 17% · 7 天 68% · 今天 $3.10（seats --quota 40 秒前）',
  '  殘留   2 項可清',
  '── 最近對話 ──────────────────────────────────────────',
  '  PM 01M7N33J 三條硬規定：分頁列在最下一列、高度固定、過期標紅',
]
const GOLD_120 = GOLD_160
const GOLD_80 = [
  '→ 待決 3 張卡等你（最舊 40 分）：q',
  '── 全艦隊 ──',
  '產線 51 ●6 ⋯40 ⊘5 · 主機 17/18',
  '▸✗ capacity 卡住 2 時：等待沒寫等誰',
  ' ⊘ hangar 01M7N2ZC 證據逾 40 分',
  ' ▲ 主機 h6 離線 12 分',
  '? 額度 personal 判定未知：缺換池資料（capacity）',
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
  expect(content(160, 40, con())[3]).toMatch(/2 時前$/)
  expect(actionsOf(160, 40, con())).toEqual(['→ 到待決頁  [2]', '→ 殘留 2 項可清  [8]'])
})

test('now: negative control, a broken golden row is reported (the comparator is not vacuous)', async () => {
  await feed()
  const broken = GOLD_80.slice()
  broken[3] = '▸✗ capacity 卡住 3 時：等待沒寫等誰'
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
  expect(out.some(r => r.includes('待決 ? 張（無來源）'))).toBe(true)
  expect(out.some(r => r.includes('無來源：沒有 console 資料'))).toBe(true)
  expect(out.some(r => r.includes('無來源：本席沒有 live 資料'))).toBe(true)
  const red = nowPage.render(ctxOf(80, 24, null, null)).body.flat().filter(s => s.text.includes('無來源'))
  expect(red.length).toBe(3)
  for (const s of red) expect(s.color).toBe(staleBadge('x').color)
})

test('now: overflow at 80x24 ends in the more row and keeps 24 rows', async () => {
  await feed()
  const ex = Array.from({ length: 9 }, (_, i) => ({ ...con().items[0], id: 'e' + i, title: 'lane' + i + ' 卡住' }))
  const out = frameRows(nowPage, ctxOf(80, 24, con({ items: ex as never }))).map(text)
  expect(out.length).toBe(24)
  expect(out.some(r => r.includes('還有'))).toBe(true)
  expect(out[out.length - 1]).toMatch(/1\D*2\D*3/)
})

test('now: a console seat shows the same body rows with a two minute old snapshot (the age is the frame header\'s)', async () => {
  await feed()
  const snap = con({ generated_at_ms: NOW - 2 * MIN, sources: { hosts: { at_ms: NOW - 2 * MIN, state: 'stale' }, tasks: { at_ms: NOW - 2 * MIN, state: 'stale' } } })
  expect(diffRows(flat(content(80, 24, snap)), GOLD_80)).toEqual([])
})

test('now: seat_blocked item is drawn from its text; stale=true is red with the source as the reason; none present adds nothing', async () => {
  await feed()
  const plainRows = content(160, 40, withItems([blocked(false)]))
  expect(plainRows.some(r => r.includes('twgame-2 額度用完：team 池 7 天用盡，週四 22:00 重置'))).toBe(true)
  expect(plainRows[3]).toContain('twgame-2 額度用完：team 池 7 天用盡，週四 22:00 重置')
  expect(plainRows.join('')).not.toContain('資料過期')
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
  expect(content(160, 40, two).some(r => r.includes('額度') && r.includes('personal'))).toBe(true)
  expect(content(160, 40, con({ quota: { pools: null, seats: [] } } as never)).some(r => r.includes('無來源：console 沒有 quota.pools'))).toBe(true)
})

// R3 now-quota-worstpool-drift: 現況 and 額度 normalise the pools the same way (no forecast source -> no projection; a seat_blocked item is that pool's limit_hit), so a pool blocked by a seat is red on both
test('now R3: a seat_blocked pool is the red worst pool on 現況 and the first red row on 額度', () => {
  const grokCodex = POOLS.filter(p => p.pool === 'grok' || p.pool === 'codex')
  const b = { ...(blocked(false) as Record<string, any>), facts: { ...(blocked(false) as Record<string, any>).facts, pool: 'codex' } }
  const c = con({ items: [b as never, ...con().items], quota: { pools: grokCodex as never, seats: [] } })
  const seg = nowPage.render(ctxOf(160, 40, c)).body.flat().find(s => s.text.includes('codex'))
  expect(seg, '現況 names codex').toBeDefined()
  expect(seg?.color, '現況 paints it red').toBe(PALETTE.broken)
  const q = renderQuota(ctxOf(160, 40, c)).body.map(text).find(l => l.startsWith('▸')) as string
  expect(q, '額度 ranks codex first and red').toContain('codex')
  expect(q).toContain('✗')
})
// R4 now-decide-count-ignores-live: the jump counts the seat's own cards the console does not list, so a missing or lagging cards source cannot hide them
test('now R4: console cards no_source plus one own pending card still shows the [2] jump', () => {
  const own = { id: 'd-11111111', title: null, question: 'q', background: null, options: [], recommendation: null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: null, origin: null, orphaned: false, kind: 'decide' }
  const base = con()
  const c = con({ counts: { ...base.counts, decisions: 0 }, cards: null, sources: { ...base.sources, cards: { at_ms: null, state: 'no_source' } } })
  const acts = nowPage.render(ctxOf(160, 40, c, live({ pending: [own] }))).actions.flat()
  expect(acts.some(s => s.text === '[2]'), 'the [2] jump is drawn').toBe(true)
  expect(acts.map(s => s.text).join('')).toContain('[2]')
})

test('now R1: on every page at 80x24, 120x30, 160x40, each pool_key appears at most once and fleet.brief pool warnings are never drawn separately', () => {
  seatQuota.reset()
  const dupPools = [
    { ...POOLS[3], pool: 'pool-f', limit_hit: true, stranded_seats: null },
    { ...POOLS[4], pool: 'F 池', limit_hit: false, projected_pct_at_reset: 120 },
    { ...POOLS[3], pool: 'pool-b', limit_hit: true, stranded_seats: null },
    POOLS[5], // trinity
  ]
  const briefWarnings = [
    { id: 'quota:pool-f:weekly', kind: 'quota', severity: 1, state: 'failed', needs_operator: true, title: 'F 池重置前用完', text: 'F 池重置前用完：週 99%', since_ms: NOW - 10 * MIN, line_id: null, to_console: true, answerable_by: [], facts: {} },
    { id: 'seat_blocked:s1', kind: 'seat_blocked', severity: 1, state: 'failed', needs_operator: true, title: 's1 額度用完', text: 's1 額度用完：F 池 7 天用盡', since_ms: NOW - 5 * MIN, line_id: null, to_console: true, answerable_by: [], facts: { seat: 's1', pool: 'pool-f' } },
  ]
  const snap = consoleOf(dupPools, { cards: [], items: briefWarnings, sources: { tasks: { at_ms: NOW - 10_000, state: 'ok' }, hosts: { at_ms: NOW - 10_000, state: 'ok' }, cards: { at_ms: NOW - 10_000, state: 'ok' }, quota_now: { at_ms: NOW - 10_000, state: 'ok' }, quota_forecast: { at_ms: NOW - 10_000, state: 'ok' } } }) as ConsoleSnapshot
  const keys = ['pool-f', 'pool-b', 'trinity']
  for (const page of PAGES.filter(p => p.framed)) {
    for (const [cols, rows] of [[80, 24], [120, 30], [160, 40]] as const) {
      const lines = frameRows(page, ctxOf(cols, rows, snap, null)).map(text)
      expect(lines.join('\n')).not.toContain('重置前用完')
      // Exclude the quota focus heading `── 焦點... ──` when counting distinct pool verdict rows per page
      const verdictLines = lines.filter(l => !l.startsWith('── 焦點'))
      for (const k of keys) {
        const label = poolLabel(k)
        const hits = verdictLines.filter(l => l.includes(label) || l.includes(poolKey(k)))
        expect(hits.length, `${page.id} ${cols}x${rows} ${k}: ${hits.join(' | ')}`).toBeLessThanOrEqual(1)
      }
    }
  }
})

test('now R2: shortBody (<= 4 rows) combines Button + pending summary first, drops duplicate 到待決頁 action row, orders pending -> red pools -> offline hosts -> stuck lines -> unknown -> yellow, and turns overflow into 另有 N 項', () => {
  seatQuota.reset()
  const cards = [
    { id: 'd-00000001', question: '合併主幹前是否要先凍結第二波評測排程並通知各線負責人確認相容性與回滾方案', status: 'open' as const, opened_at_ms: NOW - 24 * 60 * MIN, executor_display: 'PM' },
    { id: 'd-00000002', question: 'q2', status: 'open' as const, opened_at_ms: NOW - 2 * 60 * MIN, executor_display: 'PM' },
    { id: 'd-00000003', question: 'q3', status: 'open' as const, opened_at_ms: NOW - 30 * MIN, executor_display: 'PM' },
  ]
  const pools = [
    POOLS.find(p => p.pool === 'trinity')!, // red
    POOLS.find(p => p.pool === 'personal')!, // unknown
    POOLS.find(p => p.pool === 'grok')!, // yellow (waste)
  ]
  const lines = [{ line_id: 'rec', label: '復原線', lead_display: 'PM', issues: [{ rule: 'T4', state: 'failed', subject: '成員離線', since_ms: NOW - 20 * MIN, to_console: true }] }]
  const c = con({ counts: { ...con().counts, decisions: 3 }, cards, items: [], lines, quota: { pools: pools as never, seats: [] }, sources: { hosts: { at_ms: NOW - 10_000, state: 'ok' }, tasks: { at_ms: NOW - 10_000, state: 'ok' }, quota_forecast: { at_ms: NOW - 10_000, state: 'ok' } } })
  const shortRendered = nowPage.render({ ...(ctxOf(80, 7, c, live({ detail: { ...(live() as any).detail, residue: null } })) as object), shortBody: true } as never)
  expect(shortRendered.actions).toEqual([])
  expect(shortRendered.body[0][0].press).toBe('tab:2:decide')
  expect(text(shortRendered.body[0]).startsWith('→ 待決 3 張（最舊 1 天）：合併主幹前')).toBe(true)
  expect(text(shortRendered.body[0]).endsWith('…')).toBe(true)
  const framed = frameRows(nowPage, ctxOf(80, 7, c, live({ detail: { ...(live() as any).detail, residue: null } }))).map(text).slice(1, 6)
  expect(framed[0]).toContain('→ 待決 3 張（最舊 1 天）：')
  expect(framed[1]).toContain('trinity')
  expect(framed[2]).toBe('✗ 主機 離線 1 台')
  expect(framed[3]).toContain('復原線')
  expect(framed[4]).toBe('另有 2 項')
})

test('now C1: 80x24 short 現況 with 3 pending cards, 2 red pools, 1 offline host and 2 stuck lines renders pending Button without 到待決頁, orders red pools and offline host before stuck lines, shows 另有 N 項 on overflow, bottom-anchors and deduplicates pool_key', () => {
  seatQuota.reset()
  type Node = { kind: string; props: Record<string, any> }
  const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
  const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
  const walk = (n: any, out: Node[] = []): Node[] => {
    if (n == null || n === false || typeof n !== 'object') return out
    if (Array.isArray(n)) { n.forEach(x => walk(x, out)); return out }
    if (n.kind !== undefined) out.push(n)
    walk(n.props?.children, out)
    return out
  }
  const flatNode = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.flat(9).map(flatNode).join('') : n?.props ? flatNode(n.props.children) : ''

  const cards = [
    { id: 'd-c1000001', question: '是否先將第二批推理評估切往備援叢集並暫停壓測排程', status: 'open' as const, opened_at_ms: NOW - 45 * MIN, executor_display: 'PM' },
    { id: 'd-c1000002', question: 'q2', status: 'open' as const, opened_at_ms: NOW - 20 * MIN, executor_display: 'PM' },
    { id: 'd-c1000003', question: 'q3', status: 'open' as const, opened_at_ms: NOW - 5 * MIN, executor_display: 'PM' },
  ]
  const redPoolsWithDup = [
    { ...POOLS[3], pool: 'pool-f', limit_hit: true, stranded_seats: 2 },
    { ...POOLS[4], pool: 'F 池', limit_hit: false, projected_pct_at_reset: 120 },
    POOLS.find(p => p.pool === 'trinity')!,
  ]
  const stuckTwo = [
    { line_id: 'rec', label: '復原線', lead_display: 'PM', issues: [{ rule: 'T4', state: 'failed', subject: '成員離線', since_ms: NOW - 25 * MIN, to_console: true }] },
    { line_id: 'game', label: '遊戲線', lead_display: 'PM', issues: [{ rule: 'T2', state: 'stalled', subject: '工作卡住', since_ms: NOW - 15 * MIN, to_console: true }] },
  ]
  const hostItem = { id: 'exc:host:h6', kind: 'exception' as const, severity: 2, state: 'failed', needs_operator: true, title: '主機 h6 離線 12 分', text: '主機 h6 離線 12 分', since_ms: NOW - 12 * MIN, line_id: null, to_console: true, answerable_by: [], facts: {} }
  const dupPoolItems = [
    { id: 'quota:pool-f:weekly', kind: 'quota' as const, severity: 1, state: 'failed', needs_operator: true, title: 'F 池重置前用完', text: 'F 池重置前用完：週 99%', since_ms: NOW - 10 * MIN, line_id: null, to_console: true, answerable_by: [], facts: {} },
    { id: 'seat_blocked:s1', kind: 'seat_blocked' as const, severity: 1, state: 'failed', needs_operator: true, title: 's1 額度用完', text: 's1 額度用完：F 池 7 天用盡', since_ms: NOW - 5 * MIN, line_id: null, to_console: true, answerable_by: [], facts: { seat: 's1', pool: 'pool-f' } },
  ]
  const okSources = { hosts: { at_ms: NOW - 10_000, state: 'ok' as const }, tasks: { at_ms: NOW - 10_000, state: 'ok' as const }, cards: { at_ms: NOW - 10_000, state: 'ok' as const }, quota_now: { at_ms: NOW - 10_000, state: 'ok' as const }, quota_forecast: { at_ms: NOW - 10_000, state: 'ok' as const } }
  const c1Snap = con({
    counts: { ...con().counts, decisions: 3, summary: { ...con().counts.summary, hosts: { online: 17, total: 18 } } },
    cards,
    items: [...dupPoolItems, hostItem] as never,
    lines: stuckTwo,
    quota: { pools: redPoolsWithDup as never, seats: [] },
    sources: okSources,
  })
  const liveNoRes = live({ detail: { ...(live() as any).detail, residue: null } })

  // 1. Rendered through Pane at 80 cols, short inline height 7 (80x24 inline pane): pending row is a clickable Button with non-empty label, no separate 到待決頁 row, strip on last row
  const opened: string[] = []
  const tree = Pane(EL as never, liveNoRes, 'now', () => {}, t, 80, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: PAGES, pageId: 'now', onPage: id => opened.push(id), console: c1Snap, nowMs: NOW, rows: 7 })
  const nodes = walk(tree)
  const rowBoxes = nodes.filter(n => n.kind === 'Box' && /^f\d+$/.test(String(n.props.key ?? '')))
  expect(rowBoxes.length).toBe(7)
  expect(rowBoxes.map(flatNode).join('\n')).not.toContain('到待決頁')
  const pendingBtn = nodes.find(n => n.kind === 'Button' && n.props.key === 'a:1:decide')
  expect(pendingBtn, 'pending row is a Button').toBeDefined()
  expect(flatNode(pendingBtn).startsWith('→ 待決 3 張（最舊 45 分）：是否先將第二批')).toBe(true)
  expect(flatNode(pendingBtn).trim().length).toBeGreaterThan(0)
  pendingBtn!.props.onPress()
  expect(opened).toEqual(['decide'])
  const stripBtns = walk(rowBoxes[6]).filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY)
  expect(stripBtns.filter(b => /^[0-9]$/.test(b.props.hotkey ?? '')).map(b => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])

  // 2. Freed action row goes to content: 5 body rows show pending + 2 red pools + 1 offline host + 另有 2 項 (zh-TW and en), never silently dropped
  const zh7 = frameRows(nowPage, ctxOf(80, 7, c1Snap, liveNoRes), { pages: PAGES }).map(text)
  expect(zh7.length).toBe(7)
  expect(zh7.join('\n')).not.toContain('到待決頁')
  expect(zh7[1]).toContain('→ 待決 3 張（最舊 45 分）：')
  expect(zh7[2]).toContain('F 池')
  expect(zh7[3]).toContain('trinity')
  expect(zh7[4]).toContain('主機 h6 離線 12 分')
  expect(zh7[5]).toBe('另有 2 項')
  expect(zh7[6]).toContain('1 現況')

  const en7 = frameRows(nowPage, { ...(ctxOf(80, 7, c1Snap, liveNoRes) as object), t: makeT('en') } as never, { pages: PAGES }).map(text)
  expect(en7.length).toBe(7)
  expect(en7.join('\n')).not.toContain('Open the pending page')
  expect(en7[1]).toContain('→ Pending 3 (oldest 45m)：')
  expect(en7[5]).toBe('2 more items')

  // Summary-only offline host (no host item in console.items, summary.hosts 17/18) also surfaces in the offline-host slot
  const summaryOnlySnap = con({ ...c1Snap, items: dupPoolItems as never })
  const sumZh7 = frameRows(nowPage, ctxOf(80, 7, summaryOnlySnap, liveNoRes), { pages: PAGES }).map(text)
  expect(sumZh7[4]).toBe('✗ 主機 離線 1 台')
  expect(sumZh7[5]).toBe('另有 2 項')
  const sumEn7 = frameRows(nowPage, { ...(ctxOf(80, 7, summaryOnlySnap, liveNoRes) as object), t: makeT('en') } as never, { pages: PAGES }).map(text)
  expect(sumEn7[4]).toBe('✗ hosts 1 offline')
  expect(sumEn7[5]).toBe('2 more items')

  // Even at H=6 (4 body rows -> 另有 3 項) and H=3 (1 body row -> 另有 6 項), overflow is never silently dropped
  expect(frameRows(nowPage, ctxOf(80, 6, c1Snap, liveNoRes), { pages: PAGES }).map(text)[4]).toBe('另有 3 項')
  expect(frameRows(nowPage, ctxOf(80, 3, c1Snap, liveNoRes), { pages: PAGES }).map(text)[1]).toBe('另有 6 項')

  // 3. Full C1 order when all items fit: pending -> red pools -> offline hosts -> stuck/offline lines -> unknown pools -> yellow, one row each
  const allTiersSnap = con({
    ...c1Snap,
    items: [...dupPoolItems, hostItem, { id: 'exc:y1', kind: 'exception', severity: 9, state: 'findings', needs_operator: true, title: '語音線等你沒有卡', text: '語音線等你回覆', since_ms: NOW - 30 * MIN, line_id: null, to_console: true, answerable_by: [], facts: {} }] as never,
    quota: { pools: [...redPoolsWithDup, POOLS.find(p => p.pool === 'personal')!, POOLS.find(p => p.pool === 'grok')!] as never, seats: [] },
  })
  const fullShort = nowPage.render({ ...(ctxOf(80, 14, allTiersSnap, liveNoRes) as object), shortBody: true } as never).body.map(text)
  expect(fullShort.length).toBe(9)
  for (const r of fullShort) expect(displayWidth(r)).toBeLessThanOrEqual(80)
  expect(fullShort[0]).toContain('→ 待決 3 張')
  expect(fullShort[1]).toContain('F 池')
  expect(fullShort[2]).toContain('trinity')
  expect(fullShort[3]).toContain('主機 h6 離線 12 分')
  expect(fullShort[4]).toContain('復原線')
  expect(fullShort[5]).toContain('遊戲線')
  expect(fullShort[6]).toContain('personal')
  expect(fullShort[7]).toContain('grok')
  expect(fullShort[8]).toContain('語音線等你沒有卡')

  // 4. R14 bottom-anchoring: spare rows stay above content and strip stays on last row
  const fewerSnap = con({ ...c1Snap, items: [hostItem] as never, lines: [], quota: { pools: [POOLS.find(p => p.pool === 'trinity')!] as never, seats: [] } })
  const anchored = frameRows(nowPage, ctxOf(80, 7, fewerSnap, liveNoRes), { pages: PAGES }).map(text)
  expect(anchored.length).toBe(7)
  expect(anchored.slice(1, 3)).toEqual(['', ''])
  expect(anchored[3]).toContain('→ 待決 3 張')
  expect(anchored[4]).toContain('trinity')
  expect(anchored[5]).toContain('主機 h6 離線 12 分')
  expect(anchored[6]).toContain('1 現 2 待')

  // 5. Every pool_key appears at most once (including duplicate pool spellings and multiple unpooled seat_blocked items)
  const unpooledDupSnap = con({
    ...allTiersSnap,
    items: [
      ...allTiersSnap.items,
      { id: 'seat_blocked:z1', kind: 'seat_blocked', severity: 1, state: 'failed', needs_operator: true, title: 'z1 額度用完：Z 池', text: 'z1 額度用完：Z 池', since_ms: NOW - 4 * MIN, line_id: null, to_console: true, answerable_by: [], facts: { seat: 'z1', pool: 'pool-z' } },
      { id: 'seat_blocked:z2', kind: 'seat_blocked', severity: 1, state: 'failed', needs_operator: true, title: 'z2 額度用完：Z 池', text: 'z2 額度用完：Z 池', since_ms: NOW - 3 * MIN, line_id: null, to_console: true, answerable_by: [], facts: { seat: 'z2', pool: 'Z 池' } },
    ] as never,
  })
  for (const checkRows of [
    frameRows(nowPage, ctxOf(80, 7, unpooledDupSnap, liveNoRes), { pages: PAGES }).map(text),
    nowPage.render({ ...(ctxOf(80, 20, unpooledDupSnap, liveNoRes) as object), shortBody: true } as never).body.map(text),
    frameRows(nowPage, ctxOf(80, 24, unpooledDupSnap, liveNoRes), { pages: PAGES }).map(text),
  ]) {
    expect(checkRows.join('\n')).not.toContain('重置前用完')
    for (const k of ['pool-f', 'trinity', 'personal', 'grok', 'pool-z']) {
      const label = poolLabel(k)
      const hits = checkRows.filter(l => l.includes(label) || l.includes(poolKey(k)))
      expect(hits.length, `${k}: ${hits.join(' | ')}`).toBeLessThanOrEqual(1)
    }
  }
})

test('now R8 & R11: stale fleet.brief (> 10 min) marks 全艦隊 summary row; stale seat pending marks pending row; wide exception title cuts with … keeping age at right edge', async () => {
  await feed()
  const staleCon = con({ generated_at_ms: NOW - 15 * MIN, sources: { hosts: { at_ms: NOW - 15 * MIN, state: 'expired' }, tasks: { at_ms: NOW - 15 * MIN, state: 'stale' } } })
  const sum80 = content(80, 24, staleCon)[2]
  expect(sum80).toContain('✗')
  expect(sum80).toContain('15 分前')
  expect(sum80).toContain('資料已過期')

  const staleLive = live({ state: 'stale', header: '資料過舊 · watcher 沒有在發佈' })
  const pRow = nowPage.render(ctxOf(80, 24, con(), staleLive)).body[0]
  expect(text(pRow)).toContain('✗')
  expect(text(pRow)).toContain('本席待決過期：資料過舊')
  expect(pRow.some(s => s.color === PALETTE.broken)).toBe(true)

  const longText = 'capacity--claude 卡住 2 小時：' + '等待下游審批節點回應而且不能換行必須把時間固定在最右邊'.repeat(3)
  const wideCon = con({ items: [{ ...con().items[0], text: longText, title: longText }] })
  const exc120 = nowPage.render(ctxOf(120, 30, wideCon)).body.find(r => text(r).includes('capacity--claude'))!
  const raw120 = text(exc120)
  expect(displayWidth(raw120)).toBe(119)
  expect(raw120).toContain('…')
  expect(raw120.endsWith('2 時前')).toBe(true)
})

