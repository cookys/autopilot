import { test, expect } from 'claude-code/testing'
import { routeKey } from './keys'
import { frameBorderRow, frameRows, stripRows, v74BodyStatusRow } from './frame'
import { PAGES } from './index'
import { helpPage } from './help'
import { makeT } from '../i18n'
import { PALETTE } from '../../tux/palette.ts'
import { parseDecideList, makeDecideFeed, makePmFeed } from '../v74/feeds'
import { parsePmStatus } from '../v74/contract'

const t = makeT('zh-TW')
const st = (page: string) => ({ page, paneFocus: true, focusedButton: false, textMode: false })

test('v74-b: strip order is 1–9 then 0 pet (negative: no quota tab)', () => {
  const page = PAGES[0]
  const ctx = { live: null, console: null, size: { cols: 209, rows: 24 }, t, nowMs: 0 }
  const strip = stripRows(page, ctx, { pages: PAGES })
  const text = strip.map(r => r.map(s => s.text).join('')).join(' ')
  expect(text).toMatch(/1 現況.*9 說明.*0/)
  expect(text).not.toMatch(/額度/)
})

test('v74-b: bottom border row embeds per-page hint above strip', () => {
  const ctx = { live: null, console: null, size: { cols: 120, rows: 24 }, t, nowMs: 0 }
  const rows = frameRows(PAGES[1], ctx, { pages: PAGES })
  const border = rows[rows.length - 2].map(s => s.text).join('')
  const strip = rows[rows.length - 1].map(s => s.text).join('')
  expect(border.length).toBeGreaterThan(10)
  expect(border).toContain('m 附註')
  expect(border).toContain('m 附註')
  expect(strip).toContain('2 待決')
})

test('v74-b: keys route digits 1–9 and pet 0; Enter folds when no button focus', () => {
  expect(routeKey('3', st('now'))).toEqual({ kind: 'page', to: 'dispatch' })
  expect(routeKey('7', st('now'))).toEqual({ kind: 'page', to: 'fleet' })
  expect(routeKey('0', st('help'))).toEqual({ kind: 'page', to: 'pet' })
  expect(routeKey('Enter', st('fleet'))).toEqual({ kind: 'fold' })
  expect(routeKey('m', st('decide')).kind).toBe('note')
  expect(routeKey('m', st('now')).kind).toBe('none')
})

test('v74-b: help page draws S10 sections', () => {
  const ctx = { live: null, console: null, size: { cols: 120, rows: 40 }, t, nowMs: 0 }
  const body = helpPage.render(ctx).body.map(r => r.map(s => s.text).join('')).join('\n')
  expect(body).toContain('狀態')
  expect(body).toContain('1 到 9 只管切頁')
})

test('v74-b: feeds parse inline json (not used at page render time)', () => {
  const pm = JSON.stringify({ schema: 'fleet.pm.status', schema_version: 1, generated_at_ms: 1, selector: null, projects: [{ project: 'p', root_id: null, counts: { stuck: 0, overdue: 0, running: 1, waiting: 0, total: 1 }, tasks: [] }] })
  expect(parsePmStatus(pm)?.schema).toBe('fleet.pm.status')
  const cards = ['d-1', 'd-2', 'd-3'].map(id => ({ card: { card_id: id, question: 'q ' + id, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }], recommendation: 'a' } }))
  expect(parseDecideList(JSON.stringify({ cards }))?.length).toBe(3)
  expect(parseDecideList('{"cards":[]}')).toEqual([])
  expect(parseDecideList('{}')).toEqual([])
  expect(parseDecideList('not json')).toBeNull()
  expect(parseDecideList('{"cards":"nope"}')).toBeNull()
  expect(parseDecideList('{"error":"boom"}')).toBeNull()
  expect(parseDecideList('[]')).toBeNull()
  const feed = makePmFeed(0)
  expect(feed.status()).toBeNull()
  expect(feed.error()).toBeNull()
})

test('v74-b: makeDecideFeed treats {} as empty list, formats non-zero rc, and preserves invalid json error', async () => {
  const t0 = 1_795_000_000_000
  const feed = makeDecideFeed(0)
  await feed.refresh(async () => ({ exitCode: 0, stdout: '{}\n', stderr: '' }), t0, true)
  expect(feed.cards()).toEqual([])
  expect(feed.error()).toBeNull()

  const errFeed = makeDecideFeed(0)
  await errFeed.refresh(async () => ({ exitCode: 2, stdout: '', stderr: '' }), t0, true)
  expect(errFeed.cards()).toBeNull()
  expect(errFeed.error()).toBe('exit（rc=2）')

  const badJsonFeed = makeDecideFeed(0)
  await badJsonFeed.refresh(async () => ({ exitCode: 0, stdout: 'not json', stderr: '' }), t0, true)
  expect(badJsonFeed.cards()).toBeNull()
  expect(badJsonFeed.error()).toBe('invalid decision list json')
})

test('v74-b: pm and decide feeds retain last-good data and fetchedMs on failure while v74BodyStatusRow displays the failure state', async () => {
  const t0 = 1_795_000_000_000
  const t1 = t0 + 60_000
  const pmJson = JSON.stringify({
    schema: 'fleet.pm.status',
    schema_version: 1,
    generated_at_ms: t0,
    selector: null,
    projects: [{ project: 'alpha', root_id: null, counts: { stuck: 0, overdue: 0, running: 2, waiting: 0, total: 2 }, tasks: [] }],
  })
  const decideJson = JSON.stringify({
    cards: [{ card: { card_id: 'd-keep-1', kind: 'plan', question: 'Keep cached?', options: [{ label: 'yes', description: '' }, { label: 'no', description: '' }], recommendation: 'yes' } }],
  })

  const pmFeed = makePmFeed(0)
  await pmFeed.refresh(async () => ({ exitCode: 0, stdout: pmJson, stderr: '' }), t0, true)
  expect(pmFeed.status()?.projects[0]?.project).toBe('alpha')
  expect(pmFeed.fetchedMs()).toBe(t0)
  expect(pmFeed.error()).toBeNull()

  await pmFeed.refresh(async () => ({ exitCode: 1, stdout: '', stderr: 'bus timeout' }), t1, true)
  expect(pmFeed.status()?.projects[0]?.project, 'pm feed keeps last good status after failure').toBe('alpha')
  expect(pmFeed.fetchedMs(), 'pm feed keeps last ok timestamp').toBe(t0)
  expect(pmFeed.error()).toBe('bus timeout（rc=1）')

  const decFeed = makeDecideFeed(0)
  await decFeed.refresh(async () => ({ exitCode: 0, stdout: decideJson, stderr: '' }), t0, true)
  expect(decFeed.cards()?.map(c => c.id)).toEqual(['d-keep-1'])
  expect(decFeed.fetchedMs()).toBe(t0)
  expect(decFeed.error()).toBeNull()

  await decFeed.refresh(async () => ({ exitCode: 1, stdout: '', stderr: 'decision cli down' }), t1, true)
  expect(decFeed.cards()?.map(c => c.id), 'decide feed keeps last good cards after failure').toEqual(['d-keep-1'])
  expect(decFeed.fetchedMs(), 'decide feed keeps last ok timestamp').toBe(t0)
  expect(decFeed.error()).toBe('decision cli down（rc=1）')

  const nav = { cursor: 0, picks: {}, notes: {}, noteMode: false }
  const v74 = {
    pm: pmFeed.status(),
    pmFetchedMs: pmFeed.fetchedMs(),
    pmError: pmFeed.error(),
    decide: decFeed.cards(),
    decideFetchedMs: decFeed.fetchedMs(),
    decideError: decFeed.error(),
    todo: null,
    nav,
    ages: { now: pmFeed.fetchedMs(), decide: decFeed.fetchedMs() },
    errors: { now: pmFeed.error(), decide: decFeed.error() },
  }
  const baseCtx = { live: null, console: null, size: { cols: 120, rows: 24 }, t, nowMs: t1, v74 }

  const nowStatus = v74BodyStatusRow(PAGES[0], baseCtx, 120)
  expect(nowStatus).not.toBeNull()
  expect(nowStatus!.some(s => s.color === PALETTE.broken && s.text.includes('bus timeout'))).toBe(true)
  expect(nowStatus!.map(s => s.text).join('')).toContain('上次')

  const decStatus = v74BodyStatusRow(PAGES[1], baseCtx, 120)
  expect(decStatus).not.toBeNull()
  expect(decStatus!.some(s => s.color === PALETTE.broken && s.text.includes('decision cli down'))).toBe(true)
  expect(decStatus!.map(s => s.text).join('')).toContain('上次')
})
