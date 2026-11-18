import { test, expect } from 'claude-code/testing'
import { frameRows, frameHeight } from './frame'
import { nowPage } from './now'
import { quotaPage, renderQuota } from './quota'
import { fleetPage, fleetView } from './fleet'
import { consoleOf, ctxOf, POOLS, NOW, MIN } from './quota.fixture'
import { makeT } from '../i18n'
import * as M from '../model'
import { BandBar } from '../band'
import { PALETTE } from '../ui'
const text = (r: { text: string }[]) => r.map(s => s.text).join('')
const live = { state: 'ok', text: 'x', header: 'x', band: null, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW } } as never
const source = { state: 'ok', at_ms: NOW - 12000 }
const wastes = ['G 池', 'grok', 'E 池', 'lab', 'team-b'].map((pool, i) => ({ ...POOLS[1], pool, projected_pct_at_reset: 10 + i * 10 }))
const snapshot = (pools = wastes) => ({ ...(consoleOf(pools, { cards: [], lines: [] }) as any), items: [], generated_at_ms: NOW, counts: { decisions: 0, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: {}, hosts: {}, hints: 0, quota_worst: null } } })
const ctx = (cols: number, rows: number, con = snapshot()) => ({ ...(ctxOf(cols, rows, con) as object), live }) as never

test('W2: 現況 lists five waste pools and percentages wide; overflow names 額度浪費', () => {
  const wide = nowPage.render(ctx(160, 40)).body.map(text).join('\n')
  for (const [i, p] of wastes.entries()) {
    expect(wide).toContain(p.pool)
    expect(wide).toContain((90 - i * 10) + '%')
  }
  for (const rows of [4, 5, 7]) {
    const narrow = frameRows(nowPage, ctx(80, rows)).map(text).join('\n')
    expect(narrow, 'height ' + rows).toContain('額度浪費 ▲5')
    expect(narrow).not.toContain('現況 ▲5')
  }
})

const cards = [1, 2, 3].map(i => ({ id: 'd-r3-' + i, question: '是否執行 ' + i, status: 'open', opened_at_ms: NOW - i * MIN, executor_display: 'PM' }))
const redPools = ['C 池', 'D 池'].map(pool => ({ ...POOLS[5], pool, stale_age_min: 12, observed_at_ms: NOW - 12 * MIN }))
const unknownPools = ['A 池', 'B 池', 'F 池'].map(pool => ({ ...POOLS[3], pool }))

test('W4: overflow uses three real cards and counts only categories absent from the same row', () => {
  const con = snapshot([...redPools, ...unknownPools, ...wastes])
  con.cards = cards; con.counts.decisions = 3
  const single = frameRows(nowPage, ctx(80, 3, con)).map(text).join('\n')
  expect(single).toContain('待決 3 張')
  expect(single).toContain('額度浪費 ▲5')
  expect((single.match(/▲5/g) ?? []).length).toBe(1) // W4: waste pools belong to one source summary.
  expect(single).not.toContain('另有') // all three categories fit on the same row
  const two = frameRows(nowPage, ctx(80, 4, con)).map(text).join('\n')
  expect(two).toContain('待決 3 張')
  expect(two).not.toMatch(/待決 1(?:\D|$)/)
})

type Node = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') }
const flat = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : n?.props ? flat(n.props.children) : ''
const walk = (n: any): Node[] => Array.isArray(n) ? n.flatMap(walk) : n?.props ? [n, ...walk(n.props.children)] : []
const band = (con: any, snap: any = live, cols = 160) => BandBar(EL as never, snap, cols, makeT('zh-TW'), { onInfo() {}, onSlot() {}, onTab() {} }, null, null, true, null, { snap: con, tab: 'command', cols } as never, null, null, false)

test('W5: band names stale fleet age plus quota cause and repair; missing console is red; narrow quota explains stale red', () => {
  const con = snapshot(redPools)
  con.sources = { tasks: { state: 'expired', at_ms: NOW - 12 * MIN }, quota_forecast: { state: 'no_source', at_ms: null } }
  const staleLive = { ...(live as any), state: 'stale', published_at: new Date(NOW - 12 * MIN).toISOString(), text: '資料已過期' }
  const drawn = band(con, staleLive)
  const label = flat(drawn.node)
  expect(label).toContain('艦隊過期 12 分')
  expect(label).toContain('額度無預測來源')
  expect(label).toContain('autopilot status runs --watch')
  const missing = band(null)
  expect(flat(missing.node)).toContain('✗ 沒有 console 快照')
  const missingStale = flat(band(null, staleLive).node)
  expect(missingStale).toContain('12 分')
  expect(missingStale).toContain('資料已過期')
  expect(walk(missing.node).some(n => n.props.color === PALETTE.broken && flat(n).includes('沒有 console 快照'))).toBe(true)
  const now = frameRows(nowPage, ctx(80, 5, snapshot(redPools))).map(text).join('\n')
  expect(now).toContain('資料過期')
  expect(now).toContain('12 分')
})

test('V1: narrow quota labels percentages and focused verdict; one row keeps both red pools and unknown count', () => {
  const con = snapshot([...redPools, ...unknownPools, ...wastes])
  const table = frameRows(quotaPage, ctx(80, 8, con)).map(text)
  const c = table.find(r => r.includes('C 池') && r.includes('31%'))
  expect(c).toBeDefined()
  expect(c).toContain('31%✗') // R4-2: this table has a header; compact headerless rows retain labels.
  expect(c).toContain('0%✗')
  expect(c).not.toContain('7天')
  expect(c).toContain('47%✗')
  expect(c).toContain('+0.3%/時✗') // V1: label values without dropping existing rate/reset facts.
  expect(c).toContain('週五06')
  const compact = frameRows(quotaPage, ctx(80, 5, con)).map(text).join('\n')
  expect(compact).toMatch(/C 池.*判定/)
  const single = frameRows(quotaPage, ctx(80, 3, con)).map(text).join('\n')
  expect(single).toContain('✗ 額度紅 2（C 池、D 池）· ? 3')
})

const fleetSnap = () => {
  const con = snapshot([])
  con.sources.tasks = source; con.sources.hosts = source
  con.counts.summary.hosts = { online: 4, total: 6 }
  con.lines = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬'].map((label, i) => ({ line_id: 'line-' + i, label: label + '線', lead_display: 'PM', issues: i < 6 ? [{ rule: i < 2 ? 'T4' : 'T3', state: i < 2 ? 'failed' : 'stalled', subject: i < 2 ? '成員離線' : '閒置', since_ms: NOW - (20 + i) * MIN, to_console: true }] : [] }))
  return con
}

test('V2: fleet compact controls occupy one row, leaving summary and focused line visible down to one row', () => {
  const con = fleetSnap()
  const page = fleetView(ctx(80, 7, con))
  expect(page.actions.length).toBe(1)
  expect(text(page.actions[0])).toContain('上一線')
  expect(text(page.actions[0])).toContain('下一線')
  const framed = frameRows(fleetPage, ctx(80, 7, con)).map(text).join('\n')
  expect(framed).toContain('產線 9')
  expect(framed).toContain('✗ 離線 2 台主機')
  for (const h of [3, 4, 5]) {
    const out = frameRows(fleetPage, ctx(80, h, con)).map(text).join('\n')
    expect(out, 'height ' + h).toContain('乙線')
    expect(out).toContain('✗')
    expect(out).toContain('離線')
  }
})

test('V4: quota always puts o and previous/next pool in the action row directly above tabs, even twelve pools fit', () => {
  const pools = [...redPools, ...unknownPools, ...wastes, ...['H 池', 'I 池'].map(pool => ({ ...POOLS[0], pool }))]
  const con = snapshot(pools)
  const view = { focus: 0, expanded: true }
  const rendered = renderQuota(ctx(160, 40, con), view)
  expect(rendered.actions.length).toBe(1)
  const action = text(rendered.actions[0])
  expect(action).toContain('收合各席')
  expect(action).toContain('上一池')
  expect(action).toContain('下一池 (1/12)')
  expect(rendered.body.flat().some(s => s.press === 'quota:open')).toBe(false)
  const framed = frameRows({ ...quotaPage, render: c => renderQuota(c, view) }, ctx(160, 40, con))
  expect(text(framed[framed.length - 2])).toBe(action)
  const next = rendered.actions.flat().find(s => s.press === 'quota:pool:1')
  expect(next).toBeDefined()
  expect(text(renderQuota(ctx(160, 40, con), { ...view, focus: 1 }).actions[0])).toContain('(2/12)')
})

test('U1: band keeps the 艦隊 section name at 160 and 120 columns when optional speed competes for cells', () => {
  const fleet = M.slotFleet({ failed: 2, stuck: 4, normal: 3, running: 0, waiting: 0 }, makeT('zh-TW'))!
  for (const cols of [160, 120]) {
    const slots = [{ id: 'verdict', segs: [{ text: 'x'.repeat(cols - 50) }] }, fleet] as M.Slot[]
    const result = M.layoutBandLine(slots, cols, [{ text: 'x'.repeat(45), role: 'speed' }] as never)
    const label = text(result.band.segs)
    expect(label).toContain('艦隊')
    expect(label).toContain('✗ 2  ⊘ 4')
    expect(result.band.width).toBeLessThanOrEqual(cols)
    // U1: the real caller can supply a preset fitted to a smaller legacy budget.
    const segs = fleet.segs.filter(s => s.tag !== 'fleetWord').map(s => ({ ...s, slot: 'fleet' as const }))
    const drawn = BandBar(EL as never, live, cols, makeT('zh-TW'), { onInfo() {}, onSlot() {}, onTab() {} }, null, null, true, null, { snap: snapshot(), tab: 'command', cols } as never, { segs, width: 20 })
    const first = flat((drawn.node as Node).props.children[0])
    expect(first).toContain('艦隊')
    expect(first).toContain('✗ 2  ⊘ 4')
  }
})

test('U3: now and fleet summaries sort failed before stalled before normal', () => {
  const con = fleetSnap()
  for (const page of [nowPage, fleetPage]) {
    const summary = frameRows(page, ctx(80, 24, con)).map(text).find(r => r.includes('產線 9'))
    expect(summary).toContain('產線 9 ✗2 ⊘4 ○3')
  }
})

test('W2 W4: wide overflow counts real hidden pools and calls them 額度浪費, excluding seat chrome', () => {
  const con = snapshot([...redPools, ...unknownPools, ...wastes])
  const out = frameRows(nowPage, ctx(160, 8, con)).map(text).join('\n')
  expect(out).toContain('額度浪費 ▲5')
  expect(out).toContain('另有 8 項') // three unknown pools and five waste pools; two red pools are visible
  expect(out).not.toContain('本席 ✗')
})
