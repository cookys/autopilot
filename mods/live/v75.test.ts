// v75.test.ts — v7.5: the band and the Pane share one pending-card state (pure parts: v75.ts, pages/decide.ts reducer).
import { test, expect } from 'claude-code/testing'
import decideFx from './fixtures/v74/decide.fixture'
import { decidePage, decideReduce, NO_NAV, previewItems, previewStale } from './pages/decide'
import type { DecideNav } from './pages/decide'
import { makeT } from './i18n'
import { V75_PANE_MIN_ROWS, v75BandRows, v75EscStep, v75FocusNext, v75Plan, v75ReopenAfterReload, v75ScrollRoute } from './v75'
import type { V75BandIn } from './v75'
import etaFx from './fixtures/v74/pool-eta.fixture'
import { parsePoolEta, poolEtaRows, renderSpend } from './pages/spend'
import type { DecideCard, V74Ctx } from './v74/contract'
import type { Row } from './pages/rows'
import { V75_MOVED, routeKey } from './pages/keys'
import { EXTRA_PAGES, PAGES } from './pages/index'
import { roomPage } from './pages/room'

const t = makeT('zh-TW')
const decide = decideFx as DecideCard[]
const v74 = (cards: DecideCard[] = decide): V74Ctx => ({ pm: null, pmFetchedMs: null, decide: cards, todo: [], nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } })
const ctxOf = (cards: DecideCard[] = decide, extra: object = {}) => ({ live: null, console: null, size: { cols: 100, rows: 40 }, t, nowMs: 1794200000000, v74: v74(cards), ...extra }) as never
const text = (r: Row): string => r.map(s => s.text).join('')
const nav0: DecideNav = { ...NO_NAV }
const bandIn = (nav: DecideNav, over: Partial<V75BandIn> = {}): V75BandIn => ({
  cards: decide, cursor: nav.cursor, picks: nav.picks, notes: nav.notes, armed: nav.armed === true, stale: false, noteMode: nav.textMode, noteBuf: nav.textBuf,
  sending: false, held: new Set(), sent: new Set(), pane: true, newCards: 0, cols: 100, t, preview: [], ...over,
})

test('v75: the band picks b -> the Pane page shows the same pick (one state, one reducer)', () => {
  const nav = decideReduce(nav0, { kind: 'pick', index: 1 }, ctxOf(), 0).nav
  expect(nav.picks[decide[0].id]).toBe(1)
  const band = v75BandRows(bandIn(nav)).map(text).join('\n')
  expect(band).toContain('→ b')
  const pane = decidePage.render({ ...(ctxOf() as object), decide: nav } as never)
  expect([...pane.body, ...pane.actions].map(text).join('\n')).toContain(decide[0].options[1].label)
})

test('v75: the Pane moves the cursor to card 2 -> the band follows (k/n and the card title)', () => {
  const nav = decideReduce(nav0, { kind: 'cursor', at: 1 }, ctxOf(), 0).nav
  expect(nav.cursor).toBe(1)
  const rows = v75BandRows(bandIn(nav))
  expect(text(rows[0])).toContain('2/' + decide.length)
  expect(text(rows[0])).toContain(decide[1].title)
})

test('v75: y is refused when the preview snapshot is stale; s again re-freezes, then y sends', () => {
  let nav = decideReduce(nav0, { kind: 'pick', index: 0 }, ctxOf(), 0).nav
  nav = decideReduce(nav, { kind: 'submit' }, ctxOf(), 0).nav
  expect(nav.armed).toBe(true)
  expect(previewItems(nav, ctxOf()).length).toBe(1)
  // a refresh changes the card's question: the frozen list no longer matches
  const changed = decide.map((c, i) => (i === 0 ? { ...c, question: c.question + ' (changed)' } : c))
  expect(previewStale(nav, ctxOf(changed))).toBe(true)
  const refused = decideReduce(nav, { kind: 'confirm' }, ctxOf(changed), 0)
  expect(refused.effect).toBeNull()
  expect(refused.nav.stale).toBe(true)
  const again = decideReduce(refused.nav, { kind: 'submit' }, ctxOf(changed), 0).nav
  expect(again.stale).toBe(false)
  expect(decideReduce(again, { kind: 'confirm' }, ctxOf(changed), 0).effect?.kind).toBe('send')
  // an unchanged list sends at once
  expect(decideReduce(nav, { kind: 'confirm' }, ctxOf(), 0).effect?.kind).toBe('send')
})

test('v75: s only opens the preview, it never sends', () => {
  const nav = decideReduce(nav0, { kind: 'pick', index: 0 }, ctxOf(), 0).nav
  const r = decideReduce(nav, { kind: 'submit' }, ctxOf(), 0)
  expect(r.effect).toBeNull()
  expect(r.nav.armed).toBe(true)
})

test('v75: PgUp / PgDn scroll only the Pane; one row is the cursor; the band never scrolls', () => {
  const open = { paneOpen: true, note: false }
  expect(v75ScrollRoute({ component: 'AbovePrompt', by: -10 }, open)).toBe('pane')
  expect(v75ScrollRoute({ component: 'Pane', by: 10 }, open)).toBe('pane')
  expect(v75ScrollRoute({ component: 'AbovePrompt', by: 1 }, open)).toBe('cursor')
  expect(v75ScrollRoute({ component: 'AbovePrompt', by: -10 }, { paneOpen: false, note: false })).toBe('swallow')
  expect(v75ScrollRoute({ component: 'AbovePrompt', by: 1 }, { paneOpen: true, note: true })).toBe('swallow')
  expect(v75ScrollRoute({ component: 'AbovePrompt' }, open)).toBe('pass')
})

test('v75: the band is 5 rows with a pending card and 1 without; the Pane lock keeps the height; a card appearing with the Pane open does not move it', () => {
  const base = { maxRows: 30, paneWanted: false, notPlaced: false, locked: null }
  expect(v75Plan({ ...base, pending: 3 }).bandRows).toBe(5)
  expect(v75Plan({ ...base, pending: 0 }).bandRows).toBe(1)
  expect(v75Plan({ ...base, pending: 2, paneWanted: true, locked: 1 }).bandRows).toBe(1)
  expect(v75Plan({ ...base, pending: 0, paneWanted: true, locked: 5 }).bandRows).toBe(5)
})

test('v75 fallback: under band + 8 content rows the Pane does not open; isPlaced=false never opens it; otherwise it does', () => {
  const base = { pending: 2, paneWanted: true, notPlaced: false, locked: null }
  expect(v75Plan({ ...base, maxRows: V75_PANE_MIN_ROWS - 1 })).toEqual({ bandRows: 5, pane: false, why: 'rows' })
  expect(v75Plan({ ...base, maxRows: V75_PANE_MIN_ROWS }).pane).toBe(true)
  expect(v75Plan({ ...base, maxRows: 40, notPlaced: true })).toEqual({ bandRows: 5, pane: false, why: 'not_placed' })
  expect(v75Plan({ ...base, maxRows: 40, paneWanted: false }).why).toBe('closed')
})

test('v75 focus: three places; a Pane element -> pane, a band element -> band, no name -> prompt; a Pane that goes away never leaves the focus there', () => {
  expect(v75FocusNext('prompt', { kind: 'focus', component: 'Pane', named: 'card:1' })).toBe('pane')
  expect(v75FocusNext('prompt', { kind: 'focus', component: 'AbovePrompt', named: 'v75:anchor' })).toBe('band')
  expect(v75FocusNext('band', { kind: 'focus', component: undefined, named: undefined })).toBe('prompt')
  expect(v75FocusNext('pane', { kind: 'pane-gone' })).toBe('band')
  expect(v75FocusNext('prompt', { kind: 'pane-gone' })).toBe('prompt')
  expect(v75FocusNext('band', { kind: 'open-pane' })).toBe('pane')
})

test('v75 Esc: one layer at a time (note, then preview, then the prompt)', () => {
  expect(v75EscStep({ note: true, armed: true })).toBe('cancel_note')
  expect(v75EscStep({ note: false, armed: true })).toBe('cancel_preview')
  expect(v75EscStep({ note: false, armed: false })).toBe('to_prompt')
})

test('v75 band rows: every row is one line within the width (never wrapped) at 40 and 120 columns; the band draws no focus colour', () => {
  for (const cols of [40, 120]) {
    const rows = v75BandRows(bandIn(nav0, { cols }))
    expect(rows.length).toBe(4)
    for (const r of rows) expect(Array.from(text(r)).length).toBeLessThanOrEqual(cols)
  }
  // the band never colours itself by focus: it cannot read it (the host marks the focused element)
  const hintOf = (pane: boolean) => text(v75BandRows(bandIn(nav0, { pane }))[3])
  expect(hintOf(true)).toContain('ctrl+x tab 進 Pane')
  expect(hintOf(false)).toContain('ctrl+x tab 拿鍵盤')
})

test('v75 preview: the band names every picked card of the frozen list, in card order, and a stale preview says so', () => {
  let nav = decideReduce(nav0, { kind: 'pick', index: 0 }, ctxOf(), 0).nav
  nav = decideReduce(nav, { kind: 'cursor', at: 1 }, ctxOf(), 0).nav
  nav = decideReduce(nav, { kind: 'pick', index: 1 }, ctxOf(), 0).nav
  nav = decideReduce(nav, { kind: 'submit' }, ctxOf(), 0).nav
  const preview = previewItems(nav, ctxOf())
  expect(preview.map(p => p.n)).toEqual([1, 2])
  const rows = v75BandRows(bandIn(nav, { armed: true, preview }))
  expect(text(rows[2])).toContain('1 a')
  expect(text(rows[2])).toContain('2 b')
  expect(text(v75BandRows(bandIn(nav, { armed: true, stale: true, preview }))[2])).toContain('已變更')
})

test('v75 gate 21: a pick under an open preview keeps it open and stale; y is refused with the reason, nothing sends; s previews again', () => {
  let nav = decideReduce(nav0, { kind: 'pick', index: 0 }, ctxOf(), 0).nav
  nav = decideReduce(nav, { kind: 'submit' }, ctxOf(), 0).nav
  nav = decideReduce(nav, { kind: 'pick', index: 1 }, ctxOf(), 0).nav
  expect(nav.armed).toBe(true)
  expect(nav.picks[decide[0].id]).toBe(1)
  expect(previewStale(nav, ctxOf())).toBe(true)
  const y = decideReduce(nav, { kind: 'confirm' }, ctxOf(), 0)
  expect(y.effect).toBeNull()
  expect(y.nav.armed).toBe(true)
  const pane = decidePage.render({ ...(ctxOf() as object), decide: nav } as never)
  expect([...pane.body, ...pane.actions].map(text).join('\n')).toContain(t('v75.stale'))
  const again = decideReduce(y.nav, { kind: 'submit' }, ctxOf(), 0).nav
  expect(previewStale(again, ctxOf())).toBe(false)
  expect(decideReduce(again, { kind: 'confirm' }, ctxOf(), 0).effect?.kind).toBe('send')
})

test('v75 gate 19: Esc in the Pane while the preview is up disarms it and nothing else', () => {
  let nav = decideReduce(nav0, { kind: 'pick', index: 0 }, ctxOf(), 0).nav
  nav = decideReduce(nav, { kind: 'submit' }, ctxOf(), 0).nav
  const r = decideReduce(nav, { kind: 'disarm' }, ctxOf(), 0)
  expect(r.nav.armed).toBe(false)
  expect(r.nav.picks[decide[0].id]).toBe(0)
  expect(r.effect).toBeNull()
})

test('v75 old shell menus: usage, pet and roundtable each have a key and a Pane page (the d/r/u/p/h shell is not drawn: the v7.4 branch returns before it)', () => {
  expect(V75_MOVED).toEqual({ r: 'room', u: 'spend', p: 'pet' })
  const st = { page: 'now', paneFocus: true, focusedButton: false, textMode: false }
  expect(routeKey('r', st)).toEqual({ kind: 'page', to: 'room' })
  expect(routeKey('u', st)).toEqual({ kind: 'page', to: 'spend' })
  expect(routeKey('p', st)).toEqual({ kind: 'page', to: 'pet' })
  expect(routeKey('0', st)).toEqual({ kind: 'page', to: 'pet' })
  expect(routeKey('u', { ...st, page: 'decide' })).toEqual({ kind: 'undo' })
  const ids = [...PAGES, ...EXTRA_PAGES].map(p => p.id)
  for (const id of ['room', 'spend', 'pet']) expect(ids).toContain(id)
  const room = roomPage.render({ ...(ctxOf() as object), room: [{ seq: 1, from: 'pm', kind: 'msg', text: 'hello' }] } as never)
  expect(room.body.map(text).join('\n')).toContain('pm hello')
  expect(roomPage.render(ctxOf()).body.map(text).join('')).toContain(t('v75.room_none'))
})

test('v75 reload: the Pane is reopened only when the owner wanted it, the host closed it and this module has not opened one', () => {
  const base = { wanted: true, hostOpen: false, paneOn: false, open: false }
  expect(v75ReopenAfterReload(base)).toBe(true)
  expect(v75ReopenAfterReload({ ...base, wanted: false })).toBe(false) // 收起 / the Pane's close cleared it
  expect(v75ReopenAfterReload({ ...base, hostOpen: true })).toBe(false) // the host kept it
  expect(v75ReopenAfterReload({ ...base, paneOn: true })).toBe(false)
  expect(v75ReopenAfterReload({ ...base, open: true })).toBe(false) // an open already asked this load
})

// capacity's pool forecast on the spend page (fixture: a real read of 2026-11-21 12:30Z, pool names made up)
const etaNow = etaFx.generated_at_ms + 60_000
const etaRows = (nowMs: number) => poolEtaRows(parsePoolEta(JSON.stringify(etaFx)), nowMs, t).map(text)
test('spend eta: an ok pool shows its %, burn rate, reset countdown and run-out time, with the alert marker', () => {
  const r = etaRows(etaNow).find(x => x.includes('alpha')) as string
  expect(r).toContain('54%')
  expect(r).toContain('1.03%/h')
  expect(r).toContain('重置')
  expect(r).toContain('用完')
  expect(r).toContain('▲')
  expect(etaRows(etaNow).find(x => x.includes('gamma'))).toContain('4%') // a 5h pool shows its 5h figure
})
test('spend eta: no_source says 未量 and never a 0; stale / expired say 過期; an empty exhaust is told by burn_reason, not computed', () => {
  const rows = etaRows(etaNow)
  const b = rows.find(x => x.includes('beta')) as string
  expect(b).toContain('未量'); expect(b).not.toContain('0%')
  expect(rows.find(x => x.includes('epsilon'))).toContain('過期')
  expect(rows.find(x => x.includes('delta'))).toContain('重置前不會用完') // a burn rate and no run-out
  expect(rows.find(x => x.includes('gamma'))).toContain('用完時間未知（無讀數') // the feed's own reason
})
test('spend eta: the whole page says 過期 only once generated_at_ms + stale_after_s is behind now', () => {
  expect(etaRows(etaFx.generated_at_ms + 1_199_000).some(x => x.includes('池預估已過期'))).toBe(false)
  const late = etaRows(etaFx.generated_at_ms + 1_201_000)
  expect(late.some(x => x.includes('池預估已過期'))).toBe(true)
  expect(late.find(x => x.includes('alpha'))).toContain('過期')
})
test('spend eta: an unreadable file or another schema is the broken row, not numbers; the page draws the feed rows instead of the console pools', () => {
  expect(parsePoolEta('not json')).toBeNull()
  expect(parsePoolEta(JSON.stringify({ ...etaFx, schema: 'other/1' }))).toBeNull()
  expect(parsePoolEta(JSON.stringify({ ...etaFx, pools: [{ pool: 'x' }] }))).toBeNull()
  expect(poolEtaRows(null, etaNow, t).map(text).join('')).toContain('沒有來源')
  const body = renderSpend({ live: null, console: null, size: { cols: 100, rows: 30 }, t, nowMs: etaNow, poolEta: parsePoolEta(JSON.stringify(etaFx)) }).body.map(text)
  expect(body.some(x => x.includes('alpha') && x.includes('54%'))).toBe(true)
})
