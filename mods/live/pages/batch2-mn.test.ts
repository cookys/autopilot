// batch2-mn.test.ts — pane batch 2, UX gate b1 round 3 (carbon) items M1-M6 and N1-N4 (codeforge backlog B49-B54, doc/backlog/pane-batch2.md @ 654635f).
// One test per item, each drawn from the screenshot case and row it names; every test is red on feat/pane-batch2 and green with the fix. Fictional data only.
// Import order: ./frame first (frame -> index -> page), as decide.ts asks.
import { test, expect } from 'claude-code/testing'
import { frameRows } from './frame'
import { PAGES } from './index'
import { fleetPage, fleetView } from './fleet'
import { renderQuota, quotaPage } from './quota'
import { decidePage } from './decide'
import { nowPage } from './now'
import { wrapRow } from './rows'
import { consoleOf, ctxOf as qctx, POOLS } from './quota.fixture'
import { pageBarStrip } from '../tabs'
import { BandBar } from '../band'
import * as M from '../model'
import { makeT } from '../i18n'

const t = makeT('zh-TW')
const NOW = 1794200000000
const MIN = 60_000
const H = 60 * MIN
const text = (row: { text: string }[]): string => row.map(s => s.text).join('')
const ctx = (cols: number, rows: number, con: unknown, live: unknown = null) => ({ live, console: con, size: { cols, rows }, t, nowMs: NOW }) as never

// ---- fixture: the S1 fleet (9 lines: 甲 乙 offline, 己 idle, six normal lines with no issue record; hosts 4/6) ----
const iss = (rule: string, subject: string, state: string, ago: number) => ({ rule, state, subject, since_ms: NOW - ago, to_console: true })
const ln = (line_id: string, label: string, issues: ReturnType<typeof iss>[] = []) => ({ line_id, label, lead_display: 'PM', issues })
const LINES9 = [
  ln('jia', '甲線', [iss('T4', '成員離線', 'failed', 20 * MIN)]),
  ln('yi', '乙線', [iss('T4', '成員離線', 'failed', 60 * MIN)]),
  ln('ji', '己線', [iss('T3', '閒置 50 分', 'stalled', 50 * MIN)]),
  ...['丙', '丁', '戊', '庚', '辛', '壬'].map((c, i) => ln('n' + i, c + '線')),
]
type Src = { at_ms: number | null; state: string }
const fleetSnap = (o: { lines?: unknown[]; hosts?: Src; tasks?: Src; generated?: number; cards?: unknown[] } = {}) => ({
  generated_at_ms: o.generated ?? NOW,
  sources: { tasks: o.tasks ?? { at_ms: NOW - 12_000, state: 'ok' }, hosts: o.hosts ?? { at_ms: NOW - 12_000, state: 'ok' } },
  counts: { decisions: 0, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: { running: 2, waiting: 1, stalled: 6 }, hosts: { online: 4, total: 6, gpu_busy: 0, gpu_total: 0 }, hints: 0, quota_worst: null } },
  quota: { pools: null, seats: [] }, items: [], cards: o.cards ?? [], lines: o.lines ?? LINES9,
}) as never
const live0 = (o: Record<string, unknown> = {}) => ({ state: 'ok', text: 'x', header: 'x', band: null, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW }, ...o }) as never


test('M2 (S1-full-p4-80x24 row 15): a cut 80-column 額度 table says how many pools of which kind are hidden, and keeps o / prev / next as Buttons', () => {
  const c = consoleOf(POOLS)
  const r = renderQuota(qctx(80, 9, c))
  const hint = r.body.map(text).find(l => l.includes('池（'))
  expect(hint, 'the pool hint row').toBeDefined()
  expect(hint).toContain('↓ 還有 6 池（')
  expect(hint).toContain('?2')
  const acts = r.actions.flat()
  expect(acts.find(s => s.text.startsWith('[o]'))?.press).toBe('quota:open')
  expect(acts.some(s => s.text === '下一池 (1/7)' && s.press === 'quota:pool:1')).toBe(true)
  expect(acts.some(s => s.text === '上一池' && typeof s.press === 'string')).toBe(true)
  // the short body (80x7) says it too, instead of dropping pools without a word
  const short = frameRows(quotaPage, qctx(80, 8, c)).map(text)
  expect(short.length).toBe(8)
  expect(short.some(l => /↓ 還有 \d+ 池/.test(l))).toBe(true)
})

const okSrc = { at_ms: NOW - 12_000, state: 'ok' }
const card = (id: string, question: string, who: string, ago: number) => ({ id, question, status: 'open', opened_at_ms: NOW - ago, executor_display: who })
const decideCon = (cards: unknown[]) => ({ generated_at_ms: NOW, sources: { cards: okSrc }, counts: { decisions: 0, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: {}, hosts: {}, hints: 0, quota_worst: null } }, quota: { pools: null, seats: [] }, items: [], cards, lines: [] }) as never
const decideLive = { state: 'ok', header: '', pending: [] } as never
const CARDS = [card('d-c0000005', '丙線：測試綠了，可以合嗎', 'PM', 5 * H), card('d-c0000024', '測試機第二槽插電', '308', 24 * H), card('d-c0000002', '戊線要不要重跑', 'PM', 2 * H)]

test('M3 (S1-full-p2-160x40 row 29 / 33): the retired decide page is one line, with no z/h/l card controls', () => {
  for (const [cols, rows] of [[160, 40], [80, 24]] as const) {
    const rendered = decidePage.render(ctx(cols, rows, decideCon(CARDS), decideLive))
    expect(rendered.body).toEqual([])
    expect(rendered.actions.map(text).join('')).toBe('待決在 band 上（d）')
    expect(rendered.actions.map(text).join('')).not.toMatch(/\[z\]|\[h\]|\[l\]/)
  }
})

test('M5 (S5-console-exit1-nofile-p1-160x40 row 34): the console band gives the idle cells to the left text, so the fix command is whole', () => {
  type Node = { kind: string; props: Record<string, any> }
  const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
  const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
  const flat = (n: any): string => (n == null || n === false ? '' : typeof n === 'string' ? n : typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(flat).join('') : n.props ? flat(n.props.children) : '')
  const reason = '沒有指標檔 · 請執行：autopilot status runs --watch'
  const snap = live0({ state: 'no-pointer', text: reason, header: reason })
  const hd = { onInfo: () => {}, onSlot: () => {}, onTab: () => {} }
  const bar = BandBar(EL as never, snap, 72, t, hd, null, null, true, null, { snap: fleetSnap(), tab: 'command', cols: 72 } as never)
  const drawn = flat(bar.node)
  expect(drawn).toContain('autopilot status runs --watch')
  expect(drawn).not.toContain('…')
  // M6: the open-pane control says what it opens, unlike the band's own [-]
  expect(drawn).toContain('[+面板]')
})

test('M6 (nojump-f23 row 34): the closed band row 2 counts quota pools, does not mark idle lines ✗, and lists 9 寵物 and 0 鍛', () => {
  const lines = [
    ln('jia', '甲線', [iss('T4', '成員離線', 'failed', 20 * MIN)]),
    ln('yi', '乙線', [iss('T4', '成員離線', 'failed', 60 * MIN)]),
    ...['丙', '丁', '戊', '己'].map((c, i) => ln('i' + i, c + '線', [iss('T3', '閒置 1 時', 'stalled', (70 + i) * MIN)])),
  ]
  // pools in the parsed shape (as now.test.ts draws them): one stale red pool, two used-up pools with no switch data (verdict unknown)
  const pools = [
    { pool: 'trinity', seven_day_pct: 31, five_hour_pct: 0, stale: true, stale_age_min: 180, stale_note: 'statusline 沒在跑', observed_at_ms: NOW - 180 * MIN },
    { pool: 'personal', limit_hit: true, stranded_seats: null, seven_day_pct: 100, five_hour_pct: 100, stale: false, observed_at_ms: NOW - 40_000 },
    { pool: 'team2', limit_hit: true, stranded_seats: null, seven_day_pct: 100, five_hour_pct: 100, stale: false, observed_at_ms: NOW - 40_000 },
  ]
  const con = { ...(fleetSnap({ lines }) as object), quota: { pools, seats: [] } }
  const strip = pageBarStrip(live0(), t, 400, null, null, con as never)
  const label = (id: string) => strip.tabs.find(x => x.id === id)?.label.text ?? ''
  expect(label('fleet')).toContain('✗2')
  expect(label('fleet')).toContain('⊘4')
  expect(label('fleet')).not.toContain('✗6')
  expect(label('quota')).toMatch(/額度\(✗1/)
  expect(label('quota')).toContain('?2')
  expect(strip.tabs.some(x => x.id === 'pet')).toBe(true)
  expect(strip.tabs.some(x => x.id === 'forge' && x.label.text.includes('鍛'))).toBe(true)
})

test('N1 (S1-full-p2-160x40 row 27): the retired decide page does not focus a card; the line says the band has it', () => {
  for (const [cols, rows] of [[160, 40], [80, 24]] as const) {
    const o = decidePage.render(ctx(cols, rows, decideCon(CARDS), decideLive))
    expect(o.body).toEqual([])
    expect(o.actions.map(text).join('')).toBe('待決在 band 上（d）')
    expect(o.actions.map(text).join('')).not.toContain('測試機第二槽插電')
  }
})

test('N3 (S1-full-p1-160x40 row 16): a reason kept whole wraps at a clause boundary on a 2-cell hanging indent, never back to column 0', () => {
  const reason = '✗ 待決 ? 張（無來源：沒有指標檔、沒有 console 快照）'
  const rows = wrapRow([{ text: reason }], 40, 2).map(text)
  expect(rows.length).toBeGreaterThan(1)
  for (const r of rows.slice(1)) expect(r.startsWith('  '), r).toBe(true)
  for (const r of rows) expect(M.displayWidth(r)).toBeLessThanOrEqual(40)
  expect(rows.join('').replace(/\s+/g, '')).toBe(reason.replace(/\s+/g, ''))
  // on the page: the 現況 pending row at 40 columns
  const framed = frameRows(nowPage, ctx(40, 24, null, null), { pages: PAGES }).map(text)
  const at = framed.findIndex(r => r.includes('✗ 待決 ? 張'))
  expect(at).toBeGreaterThanOrEqual(0)
  expect(framed[at + 1].startsWith('  '), framed[at + 1]).toBe(true)
  expect(framed[at + 1].trim()).not.toBe('')
})

test('background wrapping keeps closing punctuation off continuation starts', () => {
  for (const punctuation of ['。', '，', '）']) {
    const input = '背景甲乙丙丁' + punctuation + 'B：後續文字'
    const lines = wrapRow([{ text: input }], 12, 2).map(text)
    expect(lines.join('').replace(/ /g, '')).toBe(input)
    for (const line of lines) expect(M.displayWidth(line)).toBeLessThanOrEqual(12)
    for (const line of lines.slice(1)) expect(/^[。，）]/.test(line.trimStart())).toBe(false)
  }
})

test('N4 (S5-stale-10min-p1-160x40 row 11): a stale overview keeps the old host value with ✗ and says 資料已過期 once', () => {
  const stale = fleetSnap({ generated: NOW - 12 * MIN, hosts: { at_ms: NOW - 12 * MIN, state: 'expired' }, tasks: { at_ms: NOW - 12 * MIN, state: 'stale' } })
  for (const cols of [160, 80]) {
    const row = nowPage.render(ctx(cols, cols === 160 ? 40 : 24, stale)).body.map(text).find(r => r.includes('產線'))
    expect(row, cols + ': overview row').toBeDefined()
    expect(row).toContain('4/6✗')
    expect(row).toContain('9✗')
    expect((row as string).split('資料已過期').length - 1, cols + ': one 資料已過期').toBe(1)
    expect(row).toContain('12 分前')
  }
})
