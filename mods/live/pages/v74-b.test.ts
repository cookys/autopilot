import { test, expect } from 'claude-code/testing'
import { readFileSync } from 'node:fs'
import { routeKey } from './keys'
import { frameBorderRow, frameRows, stripRows } from './frame'
import { PAGES } from './index'
import { helpPage } from './help'
import { makeT } from '../i18n'
import { parseDecideList, makePmFeed } from '../v74/feeds'
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

test('v74-b: feeds parse fixture json (not used at page render time)', () => {
  const pm = readFileSync(new URL('../fixtures/v74/pm-status.json', import.meta.url), 'utf8')
  expect(parsePmStatus(pm)?.schema).toBe('fleet.pm.status')
  const decide = readFileSync(new URL('../fixtures/v74/decide.json', import.meta.url), 'utf8')
  const wrapped = JSON.stringify({ cards: JSON.parse(decide).map((c: { id: string }) => ({ card: { card_id: c.id, question: c.question, options: c.options?.map((o: { label: string; detail: string; recommended: boolean }) => ({ label: o.label, description: o.detail })), recommendation: c.options?.find((o: { recommended: boolean }) => o.recommended)?.label } })) })
  expect(parseDecideList(wrapped)?.length).toBe(3)
  expect(parseDecideList('{"cards":[]}')).toBeNull()
  const feed = makePmFeed(0)
  expect(feed.status()).toBeNull()
})