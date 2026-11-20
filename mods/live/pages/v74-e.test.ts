// pages/v74-e.test.ts — ux-v7.4 sub-task E: S4 派工 (one section, 線/引擎/工作/狀態, branch + timeout seconds, no foreman block) and S5 審查
// (all review rows on one page, then 推送前檢查, then 我替你決定的事). Fixtures are built here (fictional); pages read ctx.live only.
import { test, expect } from 'claude-code/testing'
import { makeT } from '../i18n'
import { NO_DETAIL, NO_SECTIONS, displayWidth } from '../model'
import type { LivePaneRow, LiveSnapshot } from '../model'
import { PALETTE } from '../../tux/palette.ts'
import { frameRows } from './frame'
import type { PageCtx, Row } from './frame'
import { PAGES } from './index'
import { dispatchView, dispatchPage } from './dispatch'
import { renderReview } from './review'

const t = makeT('zh-TW')
const NOW = 1795150000000
const MIN = 60_000
const iso = (ago: number): string => new Date(NOW - ago).toISOString()
const text = (r: Row): string => r.map(s => s.text).join('')

const run = (o: Partial<LivePaneRow> & Pick<LivePaneRow, 'run_id'>): LivePaneRow => ({
  stall: false, role: null, runner: null, model: null, started_at: null, elapsed_s: null, phase: 'running', rc: null, final_status: null,
  probe_age_s: 5, ended_at: null, ended: false, fresh: true, starting: false, ...o,
})
const RUNS: LivePaneRow[] = [
  run({ run_id: '甲線', runner: 'codex', role: 'feat/tux-sync 測試', elapsed_s: 12 * 60 }),
  run({ run_id: '乙線', runner: 'kimi', role: 'scripts README 盤點', elapsed_s: 600, ended: true, fresh: false, rc: 0, final_status: 'done', ended_at: iso(40 * MIN) }),
  run({ run_id: '丙線', runner: 'kimi', role: 'learn/search 整合測試', elapsed_s: 1200, ended: true, fresh: false, rc: 1, final_status: 'timeout', ended_at: iso(5 * MIN) }),
]

const live = (o: { rows?: LivePaneRow[] | null; review?: LiveSnapshot['review']; qc?: LiveSnapshot['detail']['qc']; decisions?: LiveSnapshot['detail']['decisions']; state?: LiveSnapshot['state']; foreman?: unknown } = {}): LiveSnapshot => ({
  state: o.state ?? 'ok', text: '', header: o.state === 'ok' || o.state === undefined ? '' : '來源過期', band: null, pending: [], project_key: 'demo', root_run_id: null, link: null,
  rows: o.rows === undefined ? RUNS : o.rows, gates: null, sections: { ...NO_SECTIONS, foreman: o.foreman ?? null }, review: o.review ?? null,
  published_at: null, watcher_note: null, session_as_of: null, host_as_of: null,
  detail: { ...NO_DETAIL, now_ms: NOW, project: 'demo', qc: o.qc ?? null, decisions: o.decisions ?? null },
} as unknown as LiveSnapshot)
const ctxOf = (l: LiveSnapshot | null, cols = 209, rows = 49): PageCtx => ({ live: l, console: null, size: { cols, rows }, t, nowMs: NOW })

test('S4 派工: one section with 線/引擎/工作/狀態, branch in 工作, timeout seconds in 狀態, no foreman block, no buttons', () => {
  const v = dispatchView(ctxOf(live({ foreman: { agents: [{ id: 'x', description: '背景代理', label: 'x', ended: false, stale: false, at_ms: NOW, age_s: 1 }], stage: 'impl', stage_at_ms: NOW, stage_age_s: 1 } })))
  const lines = v.body.map(text)
  expect(lines[0]).toMatch(/^▾ 派工 3 筆 ─+/)
  expect(lines[1]).toMatch(/線\s+引擎\s+工作\s+狀態/)
  expect(lines[2]).toMatch(/● 甲線\s+codex\s+feat\/tux-sync 測試\s+執行中 12 分$/)
  expect(lines[3]).toMatch(/✓ 乙線\s+kimi\s+scripts README 盤點\s+完成 40 分前$/)
  expect(lines[4]).toMatch(/✗ 丙線\s+kimi\s+learn\/search 整合測試\s+逾時（1200 秒）$/)
  expect(lines.join('\n')).not.toMatch(/foreman|背景代理|執行中 \d+$|已完成/)
  expect(lines[lines.length - 1]).toContain('這是執行狀態，不是進度')
  expect(v.actions).toEqual([])
  expect(v.body.flat().filter(s => s.press !== undefined).length).toBe(0)
})

test('S4 派工: failed w/o timeout says 失敗 (negative control: no 逾時), missing sources draw the broken row', () => {
  const rows = [run({ run_id: '丁線', runner: 'codex', role: 'x', elapsed_s: 30, ended: true, fresh: false, rc: 2, final_status: 'failed', ended_at: iso(2 * MIN) })]
  const l = dispatchView(ctxOf(live({ rows }))).body.map(text).join('\n')
  expect(l).toMatch(/✗ 丁線.*失敗 2 分前/)
  expect(l).not.toContain('逾時')
  const none = dispatchView(ctxOf(null)).body[0]
  expect(none.some(s => s.color === PALETTE.broken)).toBe(true)
  const norows = dispatchView(ctxOf(live({ rows: null }))).body[0]
  expect(norows.some(s => s.color === PALETTE.broken)).toBe(true)
})

test('S4 派工: frame keeps fixed height and no row is wider than the pane at 209, 120 and 80 columns', () => {
  for (const [cols, rows] of [[209, 49], [120, 30], [80, 24]] as const) {
    const out = frameRows(dispatchPage, ctxOf(live(), cols, rows), { pages: PAGES })
    expect(out.length).toBe(rows)
    for (const r of out) expect(displayWidth(text(r))).toBeLessThanOrEqual(cols)
  }
})

const REVIEW = {
  code: { phase: null, generation: 1, base: 'a1b2c3d4', head: 'f55289ca', converged: true, at: iso(10 * MIN), seats: [{ id: 'G', family: 'G', status: 'reviewed', verdict: 'SHIP-AS-IS' }, { id: 'X', family: 'X', status: 'reviewed', verdict: 'SHIP-AS-IS' }] },
  plan: { logical_plan_id: 'plan-b@1234567', generation: 2, max_generations: 2, terminal: false, verdict: null, updated_at: iso(MIN), seats: [{ id: 'G', family: 'G', status: 'FIX-THEN-SHIP', verdict: null }] },
} as unknown as LiveSnapshot['review']
const QC = { state: 'not_needed', range: 'a1b2c3d4..HEAD', protected_files_count: 0, evidence: null } as LiveSnapshot['detail']['qc']
const DEC = {
  count: 2, irreversible: 0, writers: [], undocumented: 0, identity: null, root: null, ladder: null,
  rows: [
    { round: null, decision: '合併 feat/tux-sync 進 develop（check-all 綠）', irreversible: false, writer: null, decision_id: null, source: null, root: null, at: iso(10 * MIN) },
    { round: null, decision: '改用 codex 跑 learn/search 測試（kimi 逾時兩次）', irreversible: false, writer: null, decision_id: null, source: null, root: null, at: iso(25 * MIN) },
  ],
} as LiveSnapshot['detail']['decisions']

test('S5 審查: review rows (per-engine verdict, round) then 推送前檢查 then 我替你決定的事, in that order, no buttons', () => {
  const v = renderReview(ctxOf(live({ review: REVIEW, qc: QC, decisions: DEC })))
  const lines = v.body.map(text)
  const at = (re: RegExp): number => lines.findIndex(l => re.test(l))
  expect(lines[0]).toMatch(/^▾ 程式碼審查 2 筆 ─+/)
  expect(lines[1]).toMatch(/f55289ca\s+G 引擎 SHIP-AS-IS\s+X 引擎 SHIP-AS-IS\s+· 第 1 輪/)
  expect(lines[2]).toMatch(/plan-b\s+G 引擎 FIX-THEN-SHIP\s+· 第 2 輪/)
  const qc = at(/^▾ 推送前檢查 不需要/), dec = at(/^▾ 我替你決定的事 2 件/)
  expect(qc).toBeGreaterThan(2)
  expect(dec).toBeGreaterThan(qc)
  expect(lines[qc + 1]).toMatch(/範圍\s+a1b2c3d4\.\.HEAD/)
  expect(lines[qc + 2]).toMatch(/受保護檔\s+沒有改到受保護檔案/)
  expect(lines[dec + 1]).toMatch(/◆ 合併 feat\/tux-sync 進 develop（check-all 綠）\s+· 10 分前/)
  expect(lines[dec + 2]).toMatch(/◆ 改用 codex 跑 learn\/search 測試（kimi 逾時兩次）\s+· 25 分前/)
  expect(v.actions).toEqual([])
  expect(v.body.flat().filter(s => s.press !== undefined).length).toBe(0)
})

test('S5 審查: negative control — a missing qc or decisions source drops its section instead of inventing rows; stale live draws broken', () => {
  const lines = renderReview(ctxOf(live({ review: REVIEW }))).body.map(text).join('\n')
  expect(lines).not.toContain('推送前檢查')
  expect(lines).not.toContain('我替你決定的事')
  const nowired = renderReview(ctxOf({ ...live({ review: REVIEW }), sections: { ...NO_SECTIONS, decisionsNotWired: true } } as LiveSnapshot)).body.map(text).join('\n')
  expect(nowired).toContain('替你決定的事：來源未接')
  const stale = renderReview(ctxOf(live({ review: REVIEW, state: 'stale' })))
  expect(stale.body[0].some(s => s.color === PALETTE.broken)).toBe(true)
  expect(renderReview(ctxOf(null)).body[0].some(s => s.color === PALETTE.broken)).toBe(true)
})

test('S5 審查: owed qc names its protected-file count; folded view hides decided rows but keeps the header', () => {
  const qc = { state: 'owed', range: 'a1b2c3d4..f55289ca', protected_files_count: 3, evidence: null } as LiveSnapshot['detail']['qc']
  const lines = renderReview(ctxOf(live({ review: REVIEW, qc, decisions: DEC })), { focus: 0, expanded: false }).body.map(text).join('\n')
  expect(lines).toContain('改到 3 個受保護檔案')
  expect(lines).toContain('我替你決定的事 2 件')
  expect(lines).not.toContain('合併 feat/tux-sync')
})

test('S5 審查: frame keeps fixed height and no row wider than the pane at 209, 120 and 80 columns', () => {
  const l = live({ review: REVIEW, qc: QC, decisions: DEC })
  for (const [cols, rows] of [[209, 49], [120, 30], [80, 24]] as const) {
    const out = frameRows(PAGES.find(p => p.id === 'review')!, ctxOf(l, cols, rows), { pages: PAGES })
    expect(out.length).toBe(rows)
    for (const r of out) expect(displayWidth(text(r))).toBeLessThanOrEqual(cols)
  }
})
