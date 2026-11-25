// mods/live/pages/v74-trace-s2.test.ts — Traceability s2 tests: G04 (v74TitleSegs + boxed top border), G11 (feed layer), G13 (feed layer).
import { test, expect } from 'claude-code/testing'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { makeT } from '../i18n'
import { displayWidth, NO_DETAIL, NO_SECTIONS } from '../model'
import type { LiveSnapshot, Seg } from '../model'
import { Pane } from '../pane'
import { PAGES } from './index'
import { V74_SOURCES, V74_STALE_MS, v74BodyStatusRow, v74TitleSegs } from './frame'
import type { PageCtx } from './frame'
import { makeDecideFeed, makePmFeed, mergeDecideCards, parseDecideList } from '../v74/feeds'
import type { PmStatus, V74Ctx } from '../v74/contract'

const tZh = makeT('zh-TW')
const tEn = makeT('en')
const NOW = 1794200000000
const MIN = 60_000

const PM_JSON = JSON.stringify({
  schema: 'fleet.pm.status',
  schema_version: 1,
  generated_at_ms: NOW,
  selector: null,
  projects: [{ project: 'demo', root_id: null, counts: { stuck: 0, overdue: 0, running: 1, waiting: 0, total: 1 }, tasks: [] }],
})
const PM_OBJ: PmStatus = JSON.parse(PM_JSON)

const DECIDE_ONE_JSON = JSON.stringify({
  cards: [{ card: { card_id: 'd-00000001', kind: 'plan', question: 'ship?', options: [{ label: 'yes', description: '' }, { label: 'no', description: '' }], recommendation: 'yes' } }],
})

const pageOf = (id: string) => PAGES.find(p => p.id === id)!
const segsText = (segs: readonly Seg[]): string => segs.map(s => s.text).join('')
const v74Of = (o: Partial<V74Ctx> = {}): V74Ctx => ({
  pm: PM_OBJ,
  pmFetchedMs: NOW - 30_000,
  pmError: null,
  decide: [],
  decideFetchedMs: NOW - 30_000,
  decideError: null,
  fleetError: null,
  todo: [],
  nav: { cursor: 0, picks: {}, notes: {}, noteMode: false },
  ages: { now: NOW - 30_000, decide: NOW - 30_000, fleet: NOW - 30_000, todo: NOW - 30_000 },
  errors: { now: null, decide: null, fleet: null },
  ...o,
})
const liveOf = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  state: 'ok',
  text: '',
  header: '',
  band: null,
  pending: [],
  project_key: 'demo',
  root_run_id: null,
  link: null,
  rows: [],
  gates: null,
  sections: NO_SECTIONS,
  review: null,
  published_at: new Date(NOW - 30_000).toISOString(),
  watcher_note: null,
  session_as_of: null,
  host_as_of: null,
  detail: { ...NO_DETAIL, now_ms: NOW, project: 'demo', load_source: { plugin_version: null, source: 'dev', marketplace: 'directory', marketplace_path: null, behind_upstream: 0, flags: [], stale_cache_dirs: [] } },
  ...over,
} as unknown as LiveSnapshot)
const conOf = (sources: Record<string, { at_ms: number | null; state: string }> = { tasks: { at_ms: NOW - 30_000, state: 'ok' } }, genAt = NOW - 30_000) => ({
  generated_at_ms: genAt,
  sources,
  counts: { decisions: 0, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: {}, hosts: { online: 1, total: 1 }, hints: 0, quota_worst: null } },
  items: [],
  cards: [],
  lines: [],
  quota: { pools: [], seats: [] },
}) as unknown as NonNullable<PageCtx['console']>

const ctxOf = (over: Partial<PageCtx> = {}): PageCtx => ({
  live: liveOf(),
  console: conOf(),
  size: { cols: 120, rows: 30 },
  t: tZh,
  nowMs: NOW,
  v74: v74Of(),
  box: true,
  ...over,
})

// ---- G11 (feed layer): empty decide list is [], not missing; DecideFeed exposes error() and preserves last fetchedMs ----
test('G11 feed: parseDecideList returns [] for empty cards array and null only on bad JSON / wrong shape', () => {
  expect(parseDecideList('{"cards":[]}')).toEqual([])
  expect(mergeDecideCards(parseDecideList('{"cards":[]}'), [])).toEqual([])
  expect(parseDecideList('not json')).toBeNull()
  expect(parseDecideList('null')).toBeNull()
  expect(parseDecideList('{}')).toEqual([]) // {} = source OK, nothing open (PM 01M85F3PA)
  expect(parseDecideList('{"cards":"nope"}')).toBeNull()
  expect(mergeDecideCards(null, [])).toBeNull()
})

test('G11 feed: makeDecideFeed exposes error() and preserves last successful fetchedMs across CLI failure, bad JSON, and timeout rejection', async () => {
  const feed = makeDecideFeed(0)
  expect(feed.cards()).toBeNull()
  expect(feed.fetchedMs()).toBeNull()
  expect(feed.error()).toBeNull()

  // 1. Valid empty list -> cards [] (NOT null), error null, fetchedMs recorded
  await feed.refresh(async () => ({ exitCode: 0, stdout: '{"cards":[]}', stderr: '' }), NOW - 8 * MIN)
  expect(feed.cards()).toEqual([])
  expect(feed.error()).toBeNull()
  expect(feed.fetchedMs()).toBe(NOW - 8 * MIN)

  // 2. CLI failure -> retains last good cards ([]), error exposes stderr first line, fetchedMs preserves last success
  await feed.refresh(async () => ({ exitCode: 1, stdout: '', stderr: '\n  hub unreachable\nstack trace' }), NOW - 4 * MIN)
  expect(feed.cards()).toEqual([])
  expect(feed.error()).toBe('hub unreachable（rc=1）')
  expect(feed.fetchedMs()).toBe(NOW - 8 * MIN)

  // 3. Invalid JSON on exit 0 -> retains last good cards ([]), error set, fetchedMs NOT overwritten
  await feed.refresh(async () => ({ exitCode: 0, stdout: 'not-json', stderr: '' }), NOW - 2 * MIN)
  expect(feed.cards()).toEqual([])
  expect(feed.error()).toBe('invalid decision list json')
  expect(feed.fetchedMs()).toBe(NOW - 8 * MIN)

  // 4. Runner rejection (timeout) -> retains last good cards ([]), error captured, fetchedMs preserved
  await feed.refresh(async () => { throw new Error('command timed out') }, NOW - MIN)
  expect(feed.cards()).toEqual([])
  expect(feed.error()).toBe('command timed out')
  expect(feed.fetchedMs()).toBe(NOW - 8 * MIN)

  // 5. Recovery -> error clears, cards & fetchedMs updated
  await feed.refresh(async () => ({ exitCode: 0, stdout: DECIDE_ONE_JSON, stderr: '' }), NOW)
  expect(feed.cards()?.length).toBe(1)
  expect(feed.error()).toBeNull()
  expect(feed.fetchedMs()).toBe(NOW)
})

// ---- G13 (feed layer): PmFeed exposes error() and preserves last successful fetchedMs ----
test('G13 feed: makePmFeed exposes error() and preserves last successful fetchedMs across CLI failure, bad schema, and rejection', async () => {
  const feed = makePmFeed(0)
  expect(feed.status()).toBeNull()
  expect(feed.fetchedMs()).toBeNull()
  expect(feed.error()).toBeNull()

  await feed.refresh(async () => ({ exitCode: 0, stdout: PM_JSON, stderr: '' }), NOW - 10 * MIN)
  expect(feed.status()?.schema).toBe('fleet.pm.status')
  expect(feed.error()).toBeNull()
  expect(feed.fetchedMs()).toBe(NOW - 10 * MIN)

  await feed.refresh(async () => ({ exitCode: 2, stdout: '', stderr: 'pm daemon offline\ndetail' }), NOW - 5 * MIN)
  expect(feed.status()).toEqual(PM_OBJ)
  expect(feed.error()).toBe('pm daemon offline（rc=2）')
  expect(feed.fetchedMs()).toBe(NOW - 10 * MIN)

  await feed.refresh(async () => ({ exitCode: 0, stdout: '{"schema":"wrong"}', stderr: '' }), NOW - 2 * MIN)
  expect(feed.status()).toEqual(PM_OBJ)
  expect(feed.error()).toBe('invalid pm status json')
  expect(feed.fetchedMs()).toBe(NOW - 10 * MIN)

  await feed.refresh(async () => { throw new Error('ETIMEDOUT') }, NOW - MIN)
  expect(feed.status()).toEqual(PM_OBJ)
  expect(feed.error()).toBe('ETIMEDOUT')
  expect(feed.fetchedMs()).toBe(NOW - 10 * MIN)

  await feed.refresh(async () => ({ exitCode: 0, stdout: PM_JSON, stderr: '' }), NOW)
  expect(feed.status()?.schema).toBe('fleet.pm.status')
  expect(feed.error()).toBeNull()
  expect(feed.fetchedMs()).toBe(NOW)
})

// ---- G04 (4): V74_SOURCES matches the warning-free design titles (no warnings in border) ----
test('G04 (4): V74_SOURCES matches design titles and v74TitleSegs puts no warnings or thresholds in the top border', () => {
  expect(V74_SOURCES.now).toEqual(['fleet pm status --json', 'fleet.pm.status v1'])
  expect(V74_SOURCES.decide).toEqual(['fleet decisions list --json', 'fleet.decisions v1'])
  expect(V74_SOURCES.dispatch).toEqual(['autopilot status runs --json', 'autopilot.runs v1'])
  expect(V74_SOURCES.review).toEqual(['autopilot status review --json', 'autopilot.review v1'])
  expect(V74_SOURCES.spend).toEqual(['codeforge usage summary --json', 'usage.summary v1'])
  expect(V74_SOURCES.hygiene).toEqual(['autopilot hygiene --json', 'autopilot.hygiene v1'])
  expect(V74_SOURCES.fleet).toEqual(['fleet tasks --tree --json', 'fleet.tasks v1'])
  expect(V74_SOURCES.todo).toEqual(['fleet todo --json', 'fleet.todo v1'])

  const staleTitle = v74TitleSegs(pageOf('decide'), ctxOf({
    v74: v74Of({ decideFetchedMs: NOW - 8 * MIN, ages: { decide: NOW - 8 * MIN } }),
  }), { text: '待決' })
  expect(segsText(staleTitle)).toBe('待決 · 480 秒前更新')
  const noAgeTitle = v74TitleSegs(pageOf('decide'), ctxOf({ v74: v74Of({ decideFetchedMs: null, ages: {} }) }), { text: '待決' })
  expect(segsText(noAgeTitle)).toBe('待決')
  expect(segsText(staleTitle)).not.toContain('>5 分')
  expect(staleTitle.some(s => s.color === PALETTE.attention || s.color === PALETTE.broken)).toBe(false)
})

// ---- G04 (1): 5m threshold + stale colouring (PALETTE.attention) live on the first body row (v74BodyStatusRow), never the top border ----
test('G04 (1): v74BodyStatusRow shows 5m threshold and colours stale (>5m or live.state=stale) in PALETTE.attention in both zh-TW and en', () => {
  expect(V74_STALE_MS).toBe(5 * MIN)

  // Boundary: exact 5m is still fresh (no warning row), 5m + 1ms is stale (PALETTE.attention)
  const exact5m = v74BodyStatusRow(pageOf('now'), ctxOf({ v74: v74Of({ pmFetchedMs: NOW - 5 * MIN, ages: { now: NOW - 5 * MIN } }) }))
  expect(exact5m).toBeNull()

  const stale8mZh = v74BodyStatusRow(pageOf('now'), ctxOf({ v74: v74Of({ pmFetchedMs: NOW - 8 * MIN, ages: { now: NOW - 8 * MIN } }) }))!
  const staleSegZh = stale8mZh.find(s => s.color === PALETTE.attention)
  expect(staleSegZh, 'stale body status segment is coloured PALETTE.attention').toBeDefined()
  expect(staleSegZh?.dim).not.toBe(true)
  expect(staleSegZh?.text).toContain(GLYPHS.state.stale)
  expect(staleSegZh?.text).toContain('8 分')
  expect(staleSegZh?.text).toContain('>5 分')

  const stale8mEn = v74BodyStatusRow(pageOf('now'), ctxOf({ t: tEn, v74: v74Of({ pmFetchedMs: NOW - 8 * MIN, ages: { now: NOW - 8 * MIN } }) }))!
  const staleSegEn = stale8mEn.find(s => s.color === PALETTE.attention)
  expect(staleSegEn?.text).toContain('8m')
  expect(staleSegEn?.text).toContain('>5m')

  // live.state === 'stale' with no published_at still marks stale with >5m threshold on first body row
  const liveStale = v74BodyStatusRow(pageOf('dispatch'), ctxOf({ live: liveOf({ state: 'stale', published_at: null }) }))!
  const liveStaleSeg = liveStale.find(s => s.color === PALETTE.attention)
  expect(liveStaleSeg?.text).toContain(GLYPHS.state.stale)
  expect(liveStaleSeg?.text).toContain('>5 分')
})

// ---- G04 (5): failed / missing status for now, decide, dispatch, review, hygiene, fleet + error reason + last-success age in v74BodyStatusRow ----
test('G04 (5): now, decide, dispatch, review, hygiene and fleet surface broken status, error reason, and last-success age in v74BodyStatusRow (not top border)', () => {
  // now: pm missing with error and last-success age
  const nowFailCtx = ctxOf({
    v74: v74Of({ pm: null, pmFetchedMs: NOW - 12 * MIN, pmError: 'pm daemon down', ages: { now: NOW - 12 * MIN }, errors: { now: 'pm daemon down' } }),
  })
  const nowFail = v74BodyStatusRow(pageOf('now'), nowFailCtx)!
  expect(nowFail.some(s => s.color === PALETTE.broken && s.text.includes('pm daemon down'))).toBe(true)
  expect(segsText(nowFail)).toContain('12 分')
  expect(v74TitleSegs(pageOf('now'), nowFailCtx, { text: '現況' }).some(s => s.color === PALETTE.broken)).toBe(false)

  // decide: empty [] is NOT failed; null with decideError IS failed with error + last-success age
  const decEmpty = v74BodyStatusRow(pageOf('decide'), ctxOf({
    v74: v74Of({ decide: [], decideFetchedMs: NOW - 20_000, decideError: null, ages: { decide: NOW - 20_000 }, errors: { decide: null } }),
  }))
  expect(decEmpty).toBeNull()

  const decFail = v74BodyStatusRow(pageOf('decide'), ctxOf({
    v74: v74Of({ decide: null, decideFetchedMs: NOW - 7 * MIN, decideError: 'hub unreachable', ages: { decide: NOW - 7 * MIN }, errors: { decide: 'hub unreachable' } }),
  }))!
  expect(decFail.some(s => s.color === PALETTE.broken && s.text.includes('hub unreachable'))).toBe(true)
  expect(segsText(decFail)).toContain('7 分')

  // dispatch, review, hygiene, fleet: missing live / missing rows / fleetError all draw PALETTE.broken
  for (const id of ['dispatch', 'review', 'hygiene', 'fleet'] as const) {
    const segs = v74BodyStatusRow(pageOf(id), ctxOf({ live: null }))!
    expect(segs.some(s => s.color === PALETTE.broken), id + ' with live=null is broken').toBe(true)
    expect(segsText(segs), id + ' names missing live reason').toContain('沒有 live 資料')
  }

  const fleetErr = v74BodyStatusRow(pageOf('fleet'), ctxOf({
    v74: v74Of({ fleetError: 'exit 1', ages: { fleet: NOW - 9 * MIN }, errors: { fleet: 'exit 1' } }),
  }))!
  expect(fleetErr.some(s => s.color === PALETTE.broken && s.text.includes('exit 1'))).toBe(true)
  expect(segsText(fleetErr)).toContain('9 分')

  const hygMissing = v74BodyStatusRow(pageOf('hygiene'), ctxOf({
    live: liveOf({ detail: { ...NO_DETAIL, now_ms: NOW, residue: null, load_source: null } }),
  }))!
  expect(hygMissing.some(s => s.color === PALETTE.broken)).toBe(true)
  expect(segsText(hygMissing)).toContain('沒有殘留資料')
})

// ---- G04 (2) & (3): console mostSevere & stale/failure warnings on first body row (v74-row0), clean design title in border (v74-top) ----
type Node = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
const walk = (n: any, out: Node[] = []): Node[] => {
  if (n == null || n === false || typeof n !== 'object') return out
  if (Array.isArray(n)) { n.forEach(c => walk(c, out)); return out }
  if (n.kind !== undefined) out.push(n)
  walk(n.props?.children, out)
  return out
}
const flat = (n: any): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.flat(9).map(flat).join('') : n?.props ? flat(n.props.children) : '')

test('G04 (2): boxed Pane places console mostSevere and stale warnings on first body row (v74-row0), keeping border warning-free', () => {
  const staleCon = conOf({ tasks: { at_ms: NOW - 6 * MIN, state: 'stale' }, slots: { at_ms: null, state: 'no_source' } })
  const tree = walk(Pane(EL as never, liveOf(), 'now', () => {}, tZh, 120, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: PAGES, pageId: 'now', console: staleCon, nowMs: NOW, rows: 16, v74: v74Of(), v74Box: true,
  } as never))
  const top = tree.find(n => n.kind === 'Box' && n.props.key === 'v74-top') as Node
  const row0 = tree.find(n => n.kind === 'Box' && n.props.key === 'v74-row0') as Node
  expect(top).toBeDefined()
  expect(row0).toBeDefined()
  expect(flat(top)).toContain('╭─ 現況 · 資料 fleet pm status --json（schema fleet.pm.status v1）')
  expect(flat(top)).not.toContain('資料過期')
  expect(flat(top)).not.toContain('>5 分')
  expect(flat(row0)).toContain('資料過期，6 分鐘前')

  // Stale decide page puts >5 分過舊 in first body row (v74-row0) while top border stays clean design title
  const staleDecTree = walk(Pane(EL as never, liveOf(), 'decide', () => {}, tZh, 120, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: PAGES, pageId: 'decide', console: conOf(), nowMs: NOW, rows: 16,
    v74: v74Of({ decideFetchedMs: NOW - 8 * MIN, ages: { decide: NOW - 8 * MIN } }),
    v74Box: true,
  } as never))
  const decTop = flat(staleDecTree.find(n => n.kind === 'Box' && n.props.key === 'v74-top') as Node)
  const decRow0 = flat(staleDecTree.find(n => n.kind === 'Box' && n.props.key === 'v74-row0') as Node)
  expect(decTop).toContain('╭─ 待決 · 480 秒前更新')
  expect(decTop).not.toContain('>5 分')
  expect(decRow0).toContain('8 分（>5 分過舊）')

  // Negative control: only planned-unimplemented console sources (slots/metrics/answer_log/changes) no_source draw no warning row
  const plannedOnly = conOf({ tasks: { at_ms: NOW - 10_000, state: 'ok' }, slots: { at_ms: null, state: 'no_source' }, metrics: { at_ms: null, state: 'no_source' } })
  expect(v74BodyStatusRow(pageOf('now'), ctxOf({ console: plannedOnly }))).toBeNull()
})

test('G04 (3): narrow 80-col boxed top border keeps clean title + age and first body row keeps stale threshold or failure + last-success age within 80 cols', () => {
  // 80-col box gives titleMax = 80 - 6 = 74, inner cols = 80 - 4 = 76
  for (const id of ['now', 'decide', 'dispatch', 'review', 'spend', 'hygiene', 'fleet'] as const) {
    const freshTitle = v74TitleSegs(pageOf(id), ctxOf(), { text: tZh('tab.' + id) }, 74)
    expect(displayWidth(segsText(freshTitle)), id + ' fresh title fits 74').toBeLessThanOrEqual(74)
    expect(segsText(freshTitle), id + ' fresh keeps 30 秒 age at 80 cols').toContain('30 秒')
    expect(segsText(freshTitle), id + ' fresh border has no >5 分 warning').not.toContain('>5 分')

    const staleCtx = ctxOf({
      live: liveOf({ published_at: new Date(NOW - 8 * MIN).toISOString() }),
      console: conOf({ tasks: { at_ms: NOW - 8 * MIN, state: 'ok' } }, NOW - 8 * MIN),
      v74: v74Of({ pmFetchedMs: NOW - 8 * MIN, decideFetchedMs: NOW - 8 * MIN, ages: { now: NOW - 8 * MIN, decide: NOW - 8 * MIN, fleet: NOW - 8 * MIN } }),
    })
    const staleRow = v74BodyStatusRow(pageOf(id), staleCtx, 76)!
    expect(displayWidth(segsText(staleRow)), id + ' stale body row fits 76').toBeLessThanOrEqual(76)
    expect(segsText(staleRow), id + ' stale body row keeps 8 分 age at 80 cols').toContain('8 分')
    expect(segsText(staleRow), id + ' stale body row keeps >5 分 threshold at 80 cols').toContain('>5 分')
    expect(staleRow.some(s => s.color === PALETTE.attention), id + ' stale body row keeps warning colour at 80 cols').toBe(true)
  }

  // Long error reason at 80 cols preserves last-success age on first body row (v74-row0) while top border stays warning-free and <= 80 cols
  const longErr = 'fleet pm status failed: ' + 'x'.repeat(80)
  const tree80 = walk(Pane(EL as never, liveOf(), 'now', () => {}, tZh, 80, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: PAGES, pageId: 'now', console: conOf(), nowMs: NOW, rows: 16,
    v74: v74Of({ pm: null, pmFetchedMs: NOW - 12 * MIN, pmError: longErr, ages: { now: NOW - 12 * MIN }, errors: { now: longErr } }),
    v74Box: true,
  } as never))
  const top80 = tree80.find(n => n.kind === 'Box' && n.props.key === 'v74-top') as Node
  const row0_80 = tree80.find(n => n.kind === 'Box' && n.props.key === 'v74-row0') as Node
  const topText = flat(top80)
  const row0Text = flat(row0_80)
  expect(displayWidth(topText)).toBeLessThanOrEqual(80)
  // r10b #5 keeps the plain 「· 讀取失敗」 suffix in the title; the reason text and the stale threshold stay out of the border
  expect(topText).toContain('讀取失敗')
  expect(topText).not.toContain('fleet pm status failed')
  expect(topText).not.toContain('>5 分')
  expect(displayWidth(row0Text)).toBeLessThanOrEqual(80)
  expect(row0Text).toContain('讀取失敗')
  expect(row0Text).toContain('12 分')
})
