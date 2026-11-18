// UX gate round 2: fictional bus snapshot, rendered through the production frame.
import { test, expect } from 'claude-code/testing'
import { frameRows } from './frame'
import type { PageCtx } from './frame'
import { nowPage } from './now'
import { fleetPage, fleetView, rowsOf } from './fleet'
import { renderQuota } from './quota'
import { pageBarStrip } from '../tabs'
import { makeT } from '../i18n'
import { displayWidth, NO_DETAIL, NO_SECTIONS, slotFleet } from '../model'
import { consoleFleetCounts } from './rows'
import type { ConsoleSnapshot, ConsoleLine } from '../console'
import type { LiveSnapshot } from '../model'
import { POOLS } from './quota.fixture'

const NOW = 1794200000000, MIN = 60_000
const t = makeT('zh-TW')
const text = (row: { text: string }[]) => row.map(s => s.text).join('')
const line = (id: string, state?: string, minutes = 20): ConsoleLine => ({
  line_id: id, label: id + '線', lead_display: 'PM',
  issues: state === undefined ? [] : [{ rule: state === 'failed' ? 'T4' : 'T3', state, subject: state === 'failed' ? '成員離線' : '閒置 ' + minutes + ' 分', since_ms: NOW - minutes * MIN, to_console: true }],
} as ConsoleLine)
const snapshot = (): ConsoleSnapshot => ({
  generated_at_ms: NOW,
  sources: Object.fromEntries(['tasks', 'hosts', 'cards', 'quota_now', 'quota_forecast'].map(k => [k, { at_ms: NOW, state: 'ok' }])),
  counts: { decisions: 3, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: { running: 2, waiting: 1, stalled: 6 }, hosts: { online: 4, total: 6 }, hints: 0, quota_worst: null } },
  cards: [{ id: 'd-test', question: '繼續嗎', status: 'open', opened_at_ms: NOW - MIN, executor_display: 'PM' }],
  lines: [line('甲', 'failed'), line('乙', 'failed', 60), ...['丙', '丁', '戊', '己'].map(k => line(k, 'stalled', 220)), line('庚'), line('辛'), line('壬')],
  items: [],
  quota: { pools: [
    ...['urgent', 'stale'].map((pool, i) => ({ ...POOLS[5], pool, stale_age_min: 180 - i })),
    ...['unknown-a', 'unknown-b', 'unknown-c'].map(pool => ({ ...POOLS[3], pool })),
  ], seats: [] },
} as ConsoleSnapshot)
const live = { state: 'ok', text: '', header: '', band: null, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...NO_DETAIL, residue: { reapable: 2, by_class: {}, at: null, needs_human_count: 0, needs_human_bytes: null, needs_human: [], auto_ran_at: null, auto_removed_count: null, auto_archived_count: null } } } as LiveSnapshot
const ctx = (rows: number, con = snapshot(), cols = 80): PageCtx => ({ live, console: con, size: { cols, rows }, nowMs: NOW, t })

test('X2: 80x24 overflow names hidden severity and category, prioritizes the worst quota pool, and gives residue to tab 8', () => {
  const con = snapshot()
  // Enough exception rows to hide the five quota verdicts in the old layout.
  con.items = Array.from({ length: 18 }, (_, n) => ({ id: 'exc:' + n, kind: 'exception', state: 'stalled', title: '一般異常 ' + n, text: '一般異常 ' + n, since_ms: NOW - MIN, line_id: null, to_console: true, facts: {} })) as never
  const out = frameRows(nowPage, ctx(24, con)).map(text)
  expect(out.length).toBe(24)
  expect(out.some(r => /✗ 額度 urgent/.test(r))).toBe(true)
  const hint = out.find(r => /另有 \d+ 項/.test(r)) ?? ''
  expect(hint).toContain('額度')
  expect(hint).toContain('?3')
  expect(hint).toContain('艦隊')
  expect(out.slice(1, -1).some(r => r.includes('殘留'))).toBe(false)
  expect(frameRows(nowPage, ctx(24, con)).flat().some(s => s.press === 'tab:8:hygiene')).toBe(true)
  for (const row of out) expect(displayWidth(row)).toBeLessThanOrEqual(80)
})

test('X2: the only available row at 80x3 names the worst category, its counts and the most urgent pool', () => {
  const out = frameRows(nowPage, ctx(3)).map(text)
  expect(out.length).toBe(3)
  expect(out.join('\n')).toContain('額度 ✗2 ?3')
  expect(out.join('\n')).toContain('urgent')
  expect(out.join('\n')).not.toContain('殘留')
})

test('X2: at 80x3 quota severity stays visible with no pending decision, and seat-only quota data does not throw', () => {
  const con = snapshot()
  con.cards = []; con.counts.decisions = 0
  expect(frameRows(nowPage, ctx(3, con)).map(text).join('\n')).toContain('額度 ✗2 ?3')
  con.quota.pools = []
  con.items = [{ id: 'seat_blocked:orphan', kind: 'seat_blocked', state: 'failed', title: '池用完', text: '池用完', line_id: null, to_console: true, facts: { pool: 'orphan' } }] as never
  expect(() => frameRows(nowPage, ctx(3, con))).not.toThrow()
})

test('X3: 現況, 艦隊 and the band count the same snapshot as the expanded rows, including offline and normal lines', () => {
  const con = snapshot()
  const expected = ['✗2', '⊘4', '○3']
  const now = nowPage.render(ctx(24, con)).body.map(text).find(r => r.startsWith('產線')) ?? ''
  const fleet = fleetView(ctx(24, con)).body.map(text)[0]
  const band = pageBarStrip(live, t, 400, null, null, con).tabs.find(x => x.id === 'fleet')!.label.text
  // register.ts feeds this same bus projection into the band's summary slot.
  const bandSummary = text(slotFleet(consoleFleetCounts(con, t), t)!.segs).replace(/([✗⊘○●⋯])\s+/g, '$1')
  for (const label of [now, fleet, band, bandSummary]) for (const n of expected) expect(label).toContain(n)
  const expanded = fleetView(ctx(40, con, 160), { focus: 0, expanded: true }).body.map(text)
  for (const name of ['庚線', '辛線', '壬線']) expect(expanded.find(r => r.includes(name))).toContain('正常（無異常明細）')
  const mixed = line('混合', 'stalled')
  mixed.issues[0].rule = 'T4'
  mixed.issues[0].subject = '成員離線'
  expect(rowsOf([mixed], t)[0].sid).toBe('failed')
})

test('Y1: a cut 艦隊 list counts hidden states and offers working previous/next line Buttons at 80x24', () => {
  const con = snapshot()
  con.lines = [...con.lines!, ...Array.from({ length: 20 }, (_, i) => line('正常' + i))]
  const page = { ...fleetPage, render: (c: PageCtx) => fleetView(c, { focus: 0, expanded: true }) }
  const out = frameRows(page, ctx(24, con)).map(text)
  expect(out.length).toBe(24)
  expect(out.some(r => /↓ 還有 \d+ 項（○\d+）/.test(r))).toBe(true)
  const compact = frameRows(page, ctx(7, snapshot())).map(text)
  expect(compact.some(r => /↓ 還有 \d+ 項（✗1 ⊘4 ○3）/.test(r))).toBe(true)
  const acts = page.render(ctx(24, con)).actions.flat()
  expect(acts.some(s => s.text.includes('上一線') && s.press === 'fleet:see:乙')).toBe(true)
  expect(acts.some(s => s.text.includes('下一線') && s.press === 'fleet:see:甲')).toBe(true)
  const second = fleetView(ctx(24, con), { focus: 1, expanded: true }).actions.flat()
  expect(second.some(s => s.text.includes('上一線') && s.press === 'fleet:see:乙')).toBe(true)
  const last = rowsOf(con.lines!, t).length - 1
  const focused = rowsOf(con.lines!, t)[last].line.label
  const moved = frameRows({ ...fleetPage, render: c => fleetView(c, { focus: last, expanded: true }) }, ctx(24, con)).map(text)
  expect(moved.some(r => r.includes(focused) && r.startsWith('▸'))).toBe(true)
  for (const row of out) expect(displayWidth(row)).toBeLessThanOrEqual(80)
})

test('Y3: both pages share 產線 狀態（時長）, with 220 minutes shown once as 3 時 40 分', () => {
  const con = snapshot()
  con.lines = [line('己', 'stalled', 220)]
  con.items = [{ id: 'exc:T3:己', kind: 'exception', state: 'stalled', title: '己線閒置 220 分', text: '己線閒置 220 分', since_ms: NOW - 220 * MIN, line_id: '己', to_console: true, facts: {} }] as never
  for (const cols of [80, 160]) {
    for (const page of [nowPage, fleetPage]) {
      const row = page.render(ctx(40, con, cols)).body.map(text).find(r => r.includes('己線')) ?? ''
      expect(row).toContain('己線 閒置（3 時 40 分）')
      expect(row).not.toContain('220 分')
      expect((row.match(/3 時 40 分/g) ?? []).length).toBe(1)
    }
  }
  con.items = []
  expect(nowPage.render(ctx(24, con)).body.map(text).find(r => r.includes('己線'))).toContain('己線 閒置（3 時 40 分）')
})

test('Z2: a positive seat total with no seat records says the detail is missing, and o appears once', () => {
  const con = snapshot()
  con.quota.pools = [{ ...POOLS[0], pool: 'single', seats: 1 }] as never
  for (const cols of [80, 160]) for (const expanded of [false, true]) {
    const page = renderQuota(ctx(40, con, cols), { focus: 0, expanded })
    const all = [...page.body, ...page.actions].map(text).join('\n')
    expect(all).toContain('共 1 席（席位清單沒有明細）')
    expect(all).not.toContain('沒有這個池的席位')
    expect((all.match(/\[o\]/g) ?? []).length).toBe(1)
    expect([...page.body, ...page.actions].flat().filter(s => s.press === 'quota:open').length).toBe(1)
  }
  con.quota.pools = Array.from({ length: 25 }, (_, i) => ({ ...POOLS[0], pool: 'pool-' + i, seats: 1 })) as never
  const cut = renderQuota(ctx(24, con), { focus: 0, expanded: true })
  expect([...cut.body, ...cut.actions].flat().filter(s => s.press === 'quota:open').length).toBe(1)
})
