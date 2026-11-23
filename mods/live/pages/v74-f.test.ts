// pages/v74-f.test.ts — ux-v7.4 sub-task F: S6 花費 (5h/7d, pools, today tokens, 24h), S7 殘留 (three blocks, full descriptions, no buttons), S8 艦隊 (cards, 執行中 / 失敗 / 已完成).
// Each page has a negative control (missing source -> red row, no invented content). Data is built from the design's shared fixture (docs/v74/fixture.md): fictional names only.
import { test, expect } from 'claude-code/testing'
import { makeT } from '../i18n'
import * as M from '../model'
import { displayWidth } from '../model'
import type { ConsoleSnapshot } from '../console'
import type { OthersView } from '../fleet'
import { PALETTE } from '../../tux/palette.ts'
import { seatQuota } from './now'
import { fleetPage, fleetView } from './fleet'
import type { FleetCtx } from './fleet'
import { frameRows } from './frame'
import type { PageCtx, Row } from './frame'
import { hygienePage, hygieneView } from './hygiene'
import { GLYPHS } from '../../tux/glyphs.ts'
import { renderSpend, resetIn, spendPage } from './spend'
import type { DecideCard } from '../v74/contract'
import { Pane } from '../pane'
import { PAGES } from './index'

const t = makeT('zh-TW')
const NOW = Date.UTC(2026, 10, 18, 4, 0, 0)
const MIN = 60_000
const text = (row: Row): string => row.map(s => s.text).join('')
const texts = (rows: Row[]): string[] => rows.map(text)

const SEAT_JSON = JSON.stringify([{ seat: 'seat-a', pool_key: '[REDACTED]', five_hour_pct: 42, seven_day_pct: 18, stale: false, self: true }])
const okRun = (stdout: string) => async () => ({ exitCode: 0, stdout })

function pool(name: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pool: name, seven_day_pct: 18, five_hour_pct: 42, resets_at_ms: NOW + 4 * 86_400_000, burn_pct_per_h: 1, burn_window_h: 6, projected_pct_at_reset: 60,
    projected_exhaustion_at_ms: null, seat_count: 1, limit_hit: false, stale: false, stale_age_min: null, stale_note: null, observed_at_ms: NOW - 30_000,
    stranded_seats: 0, switched: null, switch_suggestion: null, ...over,
  }
}
function consoleOf(pools: Record<string, unknown>[] | null): ConsoleSnapshot {
  const ok = { at_ms: NOW - 10_000, state: 'ok' as const }
  return {
    generated_at_ms: NOW,
    sources: { tasks: ok, hosts: ok, cards: ok, quota_now: ok, quota_forecast: ok },
    counts: { decisions: 0, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: {}, hosts: { online: 4, total: 4 }, hints: 0, quota_worst: null } },
    items: [], cards: [], lines: [], quota: { pools, seats: [] },
  } as unknown as ConsoleSnapshot
}

function liveOf(over: { spend?: M.SpendView | null; rows?: M.LivePaneRow[] | null; residue?: M.ResidueView | null; load_source?: M.LoadSourceView | null; state?: 'ok' | 'stale' } = {}): M.LiveSnapshot {
  return {
    state: over.state ?? 'ok', text: '', header: '資料太舊', band: null, pending: [], project_key: 'demo', root_run_id: null, link: null,
    rows: over.rows === undefined ? [] : over.rows, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null,
    detail: {
      ...M.NO_DETAIL, now_ms: NOW, project: 'demo',
      spend: over.spend === undefined ? { session: '', host_all: '', host_all_n: 12.4, brain: null, tok: { session: null, host: 380_000 }, cap: null, mode: 'warn', hourly: [1, 2, 2, 3, 5, 6, 7, 8, 6, 4, 3, 2, 1, 1, 2, 3, 4, 5, 6, 7, 6, 5, 3, 2] } : over.spend,
      residue: over.residue === undefined ? null : over.residue,
      load_source: over.load_source === undefined ? null : over.load_source,
    },
    account: { account: undefined, quota: [{ kind: 'five_hour', pct: 42, resetsAtMs: NOW + 130 * MIN }, { kind: 'seven_day', pct: 18, resetsAtMs: NOW + 4 * 86_400_000 }] },
  } as unknown as M.LiveSnapshot
}

const nav = { cursor: 0, picks: {}, notes: {}, noteMode: false }
const ctxOf = (live: M.LiveSnapshot | null, con: ConsoleSnapshot | null, extra: Partial<FleetCtx> = {}, cols = 120, rows = 30): FleetCtx => ({ live, console: con, size: { cols, rows }, t, nowMs: NOW, ...extra })

// ---- S6 花費 ----
test('v74 F S6: 5h and 7d bars with relative resets, pools table, today tokens and the 24h trend; no money, no account block', async () => {
  seatQuota.reset()
  await seatQuota.refresh(okRun(SEAT_JSON), NOW - 30_000)
  const con = consoleOf([pool('team'), pool('pool-b', { five_hour_pct: 18, seven_day_pct: 9 }), pool('pool-c', { stale: true, stale_age_min: 180 })])
  const out = texts(renderSpend(ctxOf(liveOf(), con)).body)
  expect(out[0]).toContain('額度 依池')
  expect(out[1]).toContain('5 小時')
  expect(out[1]).toContain('42%')
  expect(out[1]).toContain('重置 2時10分')
  expect(out[2]).toContain('7 天')
  expect(out[2]).toContain('重置 4天')
  const header = out.findIndex(r => r.includes('池') && r.includes('狀況'))
  expect(header).toBeGreaterThan(2)
  expect(out.some(r => r.includes('✗') && r.includes('180 分未更新'))).toBe(true) // the stale pool says how long
  expect(out.some(r => r.includes('今天') && r.includes('380k tok'))).toBe(true)
  const last = out.findIndex(r => r.includes('近 24 小時'))
  expect(out[last + 1], 'r11 #11: the chart states its unit and source').toMatch(/USD.*spend-history/)
  expect(out.slice(last + 1).some(r => /[▁▂▃▄▅▆▇█]{24}/.test(r))).toBe(true)
  const all = out.join('\n')
  expect(all).not.toMatch(/\$\s*[\d—]/) // no money
  expect(all).not.toContain('帳號') // no account block
  expect(all).not.toContain('額度看 [4]') // the old jump to the quota page is gone
  // nothing clickable on the page: the meters are no longer Buttons
  expect(renderSpend(ctxOf(liveOf(), con)).body.flat().some(s => s.press !== undefined)).toBe(false)
  // the frame keeps the fixed height
  expect(frameRows(spendPage, ctxOf(liveOf(), con)).length).toBe(30)
})

test('v74 F S6 negative control: missing quota feed, console and spend draw red broken rows, not invented numbers', () => {
  seatQuota.reset()
  const live = liveOf({ spend: null })
  ;(live as unknown as { account: unknown }).account = { account: undefined, quota: [] }
  const body = renderSpend(ctxOf(live, null)).body
  const out = texts(body)
  expect(out.some(r => r.includes('無來源'))).toBe(true)
  expect(out.join('\n')).not.toContain('380k')
  expect(out.join('\n')).not.toMatch(/\d+%/)
  const broken = body.filter(r => r.some(s => s.color === PALETTE.broken))
  expect(broken.length).toBeGreaterThanOrEqual(3) // seat quota, pools and spend each say so
})

test('v74 F S6: resetIn formats the time left', () => {
  expect(resetIn(NOW + 130 * MIN, NOW, t)).toBe('2時10分')
  expect(resetIn(NOW + 120 * MIN, NOW, t)).toBe('2時')
  expect(resetIn(NOW + 4 * 86_400_000, NOW, t)).toBe('4天')
  expect(resetIn(NOW + 35 * MIN, NOW, t)).toBe('35分')
  expect(resetIn(null, NOW, t)).toBe('—')
})

// ---- S7 殘留 ----
const RESIDUE: M.ResidueView = {
  reapable: 1, by_class: {}, at: new Date(NOW).toISOString(), needs_human_count: 1, needs_human_bytes: null,
  needs_human: [{ kind: 'worktree', target: 'feat/old-probe', class: 'unintegrated-branch', age_days: 5, bytes: null, reason: '5 天沒有 commit', command: null }],
  auto_ran_at: new Date(NOW - 60 * MIN).toISOString(), auto_removed_count: 2, auto_archived_count: null,
}
const LOAD_DEV: M.LoadSourceView = { plugin_version: null, source: 'dev', marketplace: 'directory', marketplace_path: null, behind_upstream: 0, flags: [], stale_cache_dirs: [] }

test('v74 F S7: three blocks with full descriptions and no buttons', () => {
  const view = hygieneView(ctxOf(liveOf({ residue: RESIDUE, load_source: LOAD_DEV }), null))
  const out = texts(view.body)
  expect(out[0]).toContain('要你處理 1 個 worktree')
  expect(out[1]).toContain('old-probe')
  expect(out[1]).toContain('5 天沒有 commit')
  expect(out[2]).toContain('自動清理 1 時前')
  expect(out[3]).toContain('清掉 2 個已合併的 worktree')
  expect(out[4]).toContain('外掛來源')
  expect(out[5]).toContain('forge-stats 從 develop 主 clone 載入')
  expect(view.body.flat().some(s => s.press !== undefined)).toBe(false)
  expect(view.actions).toEqual([])
  expect(frameRows(hygienePage, ctxOf(liveOf({ residue: RESIDUE, load_source: LOAD_DEV }), null)).length).toBe(30)
})

test('v74 F S7: ◉ and two spaces only inside the band frame (box); the host Pane keeps ⏶ and the locale separator', () => {
  const live = liveOf({ residue: RESIDUE, load_source: LOAD_DEV })
  const boxed = texts(hygieneView({ ...ctxOf(live, null), box: true }).body)[1]
  expect(boxed).toContain(GLYPHS.state.running + ' ')
  expect(boxed).toContain('old-probe  5 天沒有 commit')
  const host = texts(hygieneView(ctxOf(live, null)).body)[1]
  expect(host).toContain(GLYPHS.state.need_you + ' ')
  expect(host).not.toContain(GLYPHS.state.running)
  expect(host).toContain('old-probe' + t('residue.why.hyg_judge_sep') + '5 天沒有 commit')
})

test('v74 F S7: the description is the full wide wording at 80 columns too (never the cut form)', () => {
  const out = texts(hygieneView(ctxOf(liveOf({ residue: RESIDUE, load_source: LOAD_DEV }), null, {}, 80, 24)).body)
  expect(out.join('\n')).toContain('5 天沒有 commit')
  expect(out.join('\n')).toContain('forge-stats 從 develop 主 clone 載入')
})

test('v74 F S7 negative control: no residue source and no load source are red rows, and a clean list says so', () => {
  const missing = hygieneView(ctxOf(liveOf({ residue: null, load_source: null }), null))
  expect(texts(missing.body).join('\n')).toContain('無來源')
  expect(missing.body.some(r => r.some(s => s.color === PALETTE.broken))).toBe(true)
  const clean = texts(hygieneView(ctxOf(liveOf({ residue: { ...RESIDUE, needs_human_count: 0, needs_human: [], auto_removed_count: null, auto_ran_at: null }, load_source: LOAD_DEV }), null)).body)
  expect(clean[0]).toContain('要你處理')
  expect(clean.join('\n')).toContain('沒有要你處理的殘留')
  expect(clean.join('\n')).not.toContain('old-probe')
})

// ---- S8 艦隊 ----
const run = (over: Partial<M.LivePaneRow>): M.LivePaneRow => ({
  stall: false, run_id: 'run-x', role: null, runner: null, model: null, started_at: null, elapsed_s: null, phase: null, rc: null, final_status: null,
  probe_age_s: null, ended_at: null, ended: false, fresh: true, starting: false, ...over,
})
const RUNS: M.LivePaneRow[] = [
  run({ run_id: 'line-a', runner: 'codex', role: 'feat/tux-sync 測試', elapsed_s: 720 }),
  run({ run_id: 'line-b', runner: 'kimi', role: 'scripts README 盤點', ended: true, fresh: false, rc: 0, ended_at: new Date(NOW - 40 * MIN).toISOString(), elapsed_s: 300 }),
  run({ run_id: 'line-c', runner: 'kimi', role: 'learn/search 整合測試', ended: true, fresh: false, rc: 1, final_status: '逾時（1200 秒）', ended_at: new Date(NOW - 10 * MIN).toISOString(), elapsed_s: 1200 }),
]
const decide: DecideCard[] = [
  { id: 'd-a1b2c3e1', title: '合併 plan', question: 'q1', background: null, options: [] },
  { id: 'd-a1b2c3e2', title: '外掛更新時機', question: 'q2', background: null, options: [] },
]
const others: OthersView = {
  present: true, unreadable: null, syncedMs: NOW - MIN, stale: false, lastError: null, skipped: 0, todo: [], todoError: null, todoSkipped: 0, nowMs: NOW,
  cards: [{ id: 'd-a1b2c3d0', question: '清分支', title: '清分支', where: 'line-a', openedMs: NOW - 5 * MIN }],
}

test('v74 F S8: cards on top, then 執行中 / 失敗 / 已完成 with terminal runs listed, not split by line', () => {
  const ctx = ctxOf(liveOf({ rows: RUNS }), null, { v74: { pm: null, pmFetchedMs: null, decide, todo: null, nav }, others })
  const out = texts(fleetView(ctx).body)
  const at = (s: string): number => out.findIndex(r => r.includes(s))
  expect(at('待決卡 2 張（本機）')).toBe(0)
  expect(out[1]).toContain('合併 plan')
  expect(at('其他主機的卡 1 張')).toBeGreaterThan(at('外掛更新時機'))
  expect(out[at('其他主機的卡 1 張')]).toContain('1 分前')
  expect(out.some(r => r.includes('d-a1b2c3d0') && r.includes('到 line-a 回答'))).toBe(true)
  const run1 = at('執行中'), fail1 = at('失敗'), done1 = at('已完成')
  expect(run1).toBeGreaterThan(at('d-a1b2c3d0'))
  expect(fail1).toBeGreaterThan(run1)
  expect(done1).toBeGreaterThan(fail1)
  expect(out[run1]).toContain('1')
  expect(out[run1 + 1]).toContain('line-a')
  expect(out[run1 + 1]).toContain('12 分')
  expect(out[fail1 + 1]).toContain('line-c')
  expect(out[fail1 + 1]).toContain('逾時（1200 秒）')
  expect(out[done1 + 1]).toContain('line-b')
  expect(out[done1 + 1]).toContain('完成 40 分前')
  expect(fleetView(ctx).body.flat().some(s => s.press !== undefined)).toBe(false)
  expect(frameRows(fleetPage, ctx).length).toBe(30)
})

test('v74 F S8 negative control: missing cards, other-host mirror and live runs are red rows, and an empty block says 沒有', () => {
  const none = fleetView(ctxOf(null, null)).body
  const out = texts(none)
  expect(out.filter(r => r.includes('無來源')).length).toBe(3)
  expect(none.every(r => r.every(s => s.color === PALETTE.broken))).toBe(true)
  const empty = texts(fleetView(ctxOf(liveOf({ rows: [] }), null, { v74: { pm: null, pmFetchedMs: null, decide: [], todo: null, nav }, others: { ...others, cards: [] } })).body)
  expect(empty.join('\n')).toContain('執行中 ◉ 0')
  expect(empty.filter(r => r.trim() === '沒有').length).toBe(3)
  expect(empty.join('\n')).not.toContain('line-')
})

test('v74 F: every row fits in 80 columns once the frame wraps it (CJK width)', () => {
  const ctx = ctxOf(liveOf({ rows: RUNS }), consoleOf([pool('team')]), { v74: { pm: null, pmFetchedMs: null, decide, todo: null, nav }, others }, 80, 24)
  for (const page of [fleetPage, spendPage, hygienePage]) {
    for (const r of frameRows(page, ctx)) expect(displayWidth(text(r))).toBeLessThanOrEqual(80)
  }
})

// ---- cross-page consistency gates (operator UX gate), rewritten in the v7.4 shape: G3, G10, X3, Y3 ----
import { nowPage } from './now'
import { fleetLines } from '../v74/contract'
import type { PmStatus, PmTask } from '../v74/contract'

const ptask = (over: Partial<PmTask>): PmTask => ({ id: 'T', short_id: 'T', title: 't', state: 'running', owner: 'o', last_progress_at_ms: null, last_progress: null, next_evidence_due_ms: null, waiting_on: null, overdue: false, stuck: false, ...over })
const pmOf = (): PmStatus => {
  const c = (stuck: number, overdue: number, running: number, waiting: number) => ({ stuck, overdue, running, waiting, total: stuck + overdue + running + waiting })
  const proj = (project: string, counts: ReturnType<typeof c>) => ({ project, root_id: null, counts, tasks: [ptask({})] })
  return { schema: 'fleet.pm.status', schema_version: 1, generated_at_ms: NOW, selector: null, projects: [proj('甲線', c(1, 0, 0, 0)), proj('乙線', c(0, 1, 0, 0)), proj('丙線', c(0, 0, 0, 2)), proj('丁線', c(0, 0, 1, 0)), proj('戊線', c(0, 0, 2, 0))] }
}
const headCount = (out: string[], word: string): number => Number((out.find(r => r.includes(word) && /\d/.test(r)) ?? '').match(/(\d+)\s*$|[◉✗✓]\s*(\d+)/)?.slice(1).find(Boolean) ?? NaN)

test('v74 F gate G3: 艦隊 shows every run once: 執行中 + 失敗 + 已完成 = the runs in the feed, and each card header equals its listed rows', () => {
  const many = Array.from({ length: 9 }, (_, i) => run({ run_id: 'run-' + i, runner: 'codex', elapsed_s: 60 * (i + 1), ...(i < 2 ? { ended: true, fresh: false, rc: 1, final_status: 'x' } : i < 5 ? { ended: true, fresh: false, rc: 0, ended_at: new Date(NOW - 5 * MIN).toISOString() } : {}) }))
  const ctx = ctxOf(liveOf({ rows: many }), null, { v74: { pm: null, pmFetchedMs: null, decide, todo: null, nav }, others })
  const out = texts(fleetView(ctx).body)
  const n = (w: string): number => Number((out.find(r => r.includes(w) && /[◉✗✓]/.test(r)) ?? '').match(/(\d+)/)?.[1])
  expect(n('執行中') + n('失敗') + n('已完成')).toBe(9)
  expect(out.filter(r => /run-\d/.test(r)).length).toBe(9) // none folded, none dropped
  expect(Number(out[0].match(/(\d+) 張/)?.[1])).toBe(decide.length)
  expect(out.filter(r => r.includes('⬥')).length).toBe(decide.length)
  // negative control: dropping a run from the feed changes the sum, so the check is not vacuous
  const fewer = texts(fleetView(ctxOf(liveOf({ rows: many.slice(1) }), null, { v74: { pm: null, pmFetchedMs: null, decide, todo: null, nav }, others })).body)
  expect(fewer.filter(r => /run-\d/.test(r)).length).toBe(8)
})

test('v74 F gate G10: one set of names: pool "F 池" on 花費 and 現況, never the raw pool key; run states use the shared glyphs', async () => {
  seatQuota.reset()
  const con = consoleOf([pool('pool-f', { limit_hit: true, five_hour_pct: 100, seven_day_pct: 100, stranded_seats: 2 })])
  const live = liveOf()
  const spend = texts(renderSpend(ctxOf(live, con)).body).join('\n')
  const now = texts(nowPage.render({ ...ctxOf(live, con), v74: { pm: pmOf(), pmFetchedMs: NOW, decide: [], todo: null, nav } }).body).join('\n')
  expect(spend).toContain('F 池')
  expect(spend).not.toContain('pool-f')
  expect(now).not.toContain('pool-f')
  const fleet = texts(fleetView(ctxOf(liveOf({ rows: RUNS }), null, { v74: { pm: null, pmFetchedMs: null, decide: [], todo: null, nav }, others })).body)
  expect(fleet.find(r => r.includes('line-c'))?.trimStart().startsWith('✗')).toBe(true) // failed = ✗ as on every page
  expect(fleet.find(r => r.includes('line-b'))?.trimStart().startsWith('✓')).toBe(true)
  // negative control: the raw key would show if the label map were skipped
  expect(texts(renderSpend(ctxOf(live, consoleOf([pool('F 池')]))).body).join('\n')).toContain('F 池')
})

test('v74 F gate X3: 現況 counts the 產線 the same way as the shared fleetLines projection (✗ failed, ⊘ idle, ◉ ok)', () => {
  const pm = pmOf()
  const marks = fleetLines(pm).map(l => l.mark)
  const want = ['✗' + marks.filter(m => m === 'fail').length, '⊘' + marks.filter(m => m === 'parked').length, '◉' + marks.filter(m => m === 'ok').length]
  const body = texts(nowPage.render({ ...ctxOf(liveOf(), null), v74: { pm, pmFetchedMs: NOW, decide: [], todo: null, nav } }).body)
  const row = body.find(r => r.includes('產線')) ?? ''
  expect(row).toContain('產線       5')
  for (const w of want) expect(row).toContain(w)
  // negative control: a different projection is not what the page printed
  expect(row).not.toContain('✗5')
})

test('v74 F gate Y3: one duration grammar: 220 minutes reads 3 時 40 分 once on 艦隊 (running and done rows), never 220 分', () => {
  const rows = [run({ run_id: 'long-run', runner: 'codex', elapsed_s: 220 * 60 }), run({ run_id: 'long-done', runner: 'codex', ended: true, fresh: false, rc: 0, ended_at: new Date(NOW - 220 * MIN).toISOString() })]
  for (const cols of [80, 160]) {
    const out = texts(fleetView(ctxOf(liveOf({ rows }), null, { v74: { pm: null, pmFetchedMs: null, decide: [], todo: null, nav }, others }, cols)).body)
    for (const id of ['long-run', 'long-done']) {
      const row = out.find(r => r.includes(id)) ?? ''
      expect(row).toContain('3 時 40 分')
      expect(row).not.toContain('220 分')
      expect((row.match(/3 時 40 分/g) ?? []).length).toBe(1)
    }
  }
})

// B2 (a): the pane hands FramePane.others to the framed 艦隊 page; without it the row says 無來源
test('v74 F S8 wiring: Pane passes frame.others to the 艦隊 page, and omitting it shows the missing row', () => {
  const mk = (kind: string) => (props: any) => ({ kind, props })
  const el = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link') }
  const t = makeT('zh-TW')
  const textOf = (n: any): string => n == null || typeof n === 'boolean' ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.props?.children)
  const draw = (extra: Record<string, unknown>) => textOf(Pane(el, liveOf({ rows: RUNS }), 'fleet', () => {}, t, 120, undefined, undefined, undefined, undefined, null, null, null, null, null,
    { pages: PAGES, pageId: 'fleet', console: null, nowMs: NOW, rows: 30, ...extra } as any))
  expect(draw({ others })).toContain('d-a1b2c3d0')
  const missing = draw({})
  expect(missing).not.toContain('d-a1b2c3d0')
  expect(missing).toContain(t('v74.f.others_missing'))
})

test('v74 F S6: the money fields (host_all_n, brain) never draw as tokens; no token field draws the unknown string, no $ anywhere', () => {
  const money: M.SpendView = { session: '$3.10', host_all: '$12.40', host_all_n: 12.4, brain: 3.1, cap: 20, mode: 'warn' }
  const all = texts(renderSpend(ctxOf(liveOf({ spend: money }), consoleOf([pool('team')]))).body).join('\n')
  expect(all).not.toContain('12.4')
  expect(all).not.toContain('3.1')
  expect(all).not.toMatch(/\$/)
  expect(all).toContain('token 數未知')
  const real = texts(renderSpend(ctxOf(liveOf({ spend: { ...money, tok: { session: 5000, host: 380_000 } } }), consoleOf([pool('team')]))).body).join('\n')
  expect(real).toContain('380k tok')
  expect(real).not.toContain('12.4')
})

test('v74 F S6: the reset countdown units come from the locale (en draws the en strings)', () => {
  const en = makeT('en')
  expect(resetIn(NOW + 130 * MIN, NOW, en)).toBe('2h10m')
  expect(resetIn(NOW + 4 * 86_400_000, NOW, en)).toBe('4d')
  expect(resetIn(NOW + 35 * MIN, NOW, en)).toBe('35m')
})
