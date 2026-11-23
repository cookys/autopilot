// v74-r11.test.ts — r11 UX review fixes (astra 5 / opus 5 on the r10-1 shots).
import { test, expect } from 'claude-code/testing'
import { GLYPHS } from '../tux/glyphs.ts'
import { PALETTE } from '../tux/palette.ts'
import decideFx from './fixtures/v74/decide.fixture'
import { decidePage, NO_NAV } from './pages/decide'
import { frameHintText, frameHintShort } from './pages/frame'
import { actionRows } from './pages/layout'
import { renderHelp } from './pages/help'
import { shortVerdict } from './pages/quota'
import { PAGES } from './pages/index'
import { makeT } from './i18n'
import { offerTodo } from './v74/contract'
import type { DecideCard, V74Ctx } from './v74/contract'
import { v74KeysHeldNext, v74EscCancelsPreview } from './register'
import type { Row } from './pages/rows'

const t = makeT('zh-TW')
const decide = decideFx as DecideCard[]
const v74 = (o: Partial<V74Ctx> = {}): V74Ctx => ({ pm: null, pmFetchedMs: null, decide, todo: [], nav: { cursor: 0, picks: {}, notes: {}, noteMode: false }, ...o })
const ctxOf = (o: Partial<V74Ctx>, rows = 40, cols = 120, extra: object = {}) => ({ live: null, console: null, size: { cols, rows }, t, nowMs: 1794200000000, v74: v74(o), box: true, ...extra }) as never
const text = (r: Row): string => r.map(s => s.text).join('')

test('r11 #1: with no todo source the 待辦 option is not offered; with a source (even empty) it stays', () => {
  const none = offerTodo(decide, null) as DecideCard[]
  for (const c of none) expect(c.options.some(o => o.label === '待辦')).toBe(false)
  expect(none[0].options.length).toBe(decide[0].options.length - 1)
  expect(offerTodo(decide, [])).toBe(decide)
  expect(offerTodo(null, null)).toBeNull()
})

test('r11 #1: the decide page with the todo option dropped shows no 「c: 待辦」; the help page says why', () => {
  const dropped = offerTodo(decide, null) as DecideCard[]
  const { body, actions } = decidePage.render(ctxOf({ decide: dropped, todo: null }))
  expect([...body, ...actions].map(text).join('\n')).not.toContain('c: 待辦')
  expect(renderHelp(ctxOf({ todo: null })).body.map(text).join('\n')).toContain('還沒接上')
  expect(renderHelp(ctxOf({ todo: [] })).body.map(text).join('\n')).not.toContain('還沒接上')
})

test('r11 #2: send then Esc: the keys-held word falls back after the send and only a key or a person focus brings it back', () => {
  let held = false
  held = v74KeysHeldNext(held, { kind: 'open' })
  held = v74KeysHeldNext(held, { kind: 'focus', named: 'tab:decide', origin: { kind: 'person' } })
  expect(held).toBe(true)
  held = v74KeysHeldNext(held, { kind: 'key', key: 'submit' })
  held = v74KeysHeldNext(held, { kind: 'key', key: 'submit' })
  expect(held).toBe(true)
  held = v74KeysHeldNext(held, { kind: 'sent' })
  expect(held, 'after the send the first Esc stops the turn and raises no focus event: the word must not stay on 鍵盤在 pane').toBe(false)
  held = v74KeysHeldNext(held, { kind: 'focus', named: undefined, origin: undefined })
  expect(held).toBe(false)
  held = v74KeysHeldNext(held, { kind: 'key', key: 'next' })
  expect(held).toBe(true)
})

const picked = { ...NO_NAV, picks: { [decide[0].id]: 0, [decide[1].id]: 1 }, notes: { [decide[1].id]: '這是一段很長很長很長很長很長很長很長很長很長很長很長的附註' }, armed: true }
test('r11 #3/#4/#5: the preview names card number, letter, option and note; x is only in the border; the unarmed row announces the preview', () => {
  const armedRows = decidePage.render(ctxOf({}, 40, 120, { decide: picked })).actions.map(text)
  const all = armedRows.join('\n')
  expect(armedRows[0]).toContain('將送出 2 張')
  expect(all).toContain('1. ' + decide[0].title)
  expect(all).toContain(GLYPHS.structure.answer + ' a ' + decide[0].options[0].label)
  expect(all).toContain(GLYPHS.structure.answer + ' b ' + decide[1].options[1].label)
  expect(all).toContain('附註：這是一段')
  expect(all).not.toContain('Esc')
  expect(armedRows.length).toBeLessThanOrEqual(actionRows(40))
  const unarmed = decidePage.render(ctxOf({}, 40, 120, { decide: { ...picked, armed: false } })).actions.map(text).join('\n')
  expect(unarmed).toMatch(/送出已選 2 張/)
  expect(unarmed).toContain('預覽並送出已選 2 張 · 另 ')
  const page = PAGES.find(p => p.id === 'decide')!
  const armedCtx = ctxOf({}, 40, 120, { decide: picked })
  expect(frameHintText(page, armedCtx)).toContain('y 確認送出 · x 取消預覽')
  expect(frameHintText(page, armedCtx)).not.toContain('還給輸入框')
  expect(frameHintShort(page, armedCtx)).toContain('x 取消')
})

test('r11 #4: Esc while the preview is up is swallowed as a cancel; with no preview or on a band element it is not', () => {
  expect(v74EscCancelsPreview(true, true, 'decide', undefined)).toBe(true)
  expect(v74EscCancelsPreview(true, true, 'decide', 'tab:now')).toBe(false)
  expect(v74EscCancelsPreview(false, true, 'decide', undefined)).toBe(false)
  expect(v74EscCancelsPreview(true, true, 'now', undefined)).toBe(false)
  expect(v74EscCancelsPreview(true, false, 'decide', undefined)).toBe(false)
})

test('r11 #6: a missing forecast is drawn with the unknown mark, never ✗', () => {
  const pool = { pool: 'p', five_hour_pct: null, seven_day_pct: null, limit_hit: false, projected_exhaustion_at_ms: null, projected_pct_at_reset: null } as never
  const v = { kind: 'nopace', role: 'broken', pool: 'p', staleMin: null } as never
  const s = shortVerdict(pool, v, 1, false, t)
  expect(s.startsWith(GLYPHS.state.unknown + ' ')).toBe(true)
  expect(s).not.toContain(GLYPHS.state.failed)
})

test('r11 #7: the chosen answer is bold in a colour family other than the recommended star', () => {
  const rec = decide.findIndex(c => c.options.some(o => o.recommended))
  const k = decide[rec].options.findIndex(o => o.recommended)
  const other = k === 0 ? 1 : 0
  const nav = { ...NO_NAV, cursor: rec, picks: { [decide[rec].id]: other } }
  const { body } = decidePage.render(ctxOf({}, 40, 120, { decide: nav }))
  const segs = body.flat()
  const chosen = segs.find(s => s.text.includes(decide[rec].options[other].label) && s.color !== undefined)
  expect(chosen?.bold).toBe(true)
  expect(chosen?.color).not.toBe(PALETTE.attention)
})

test('r11 #8: the Enter hint names what it folds and is absent where nothing folds', () => {
  const hint = (id: string) => frameHintText(PAGES.find(p => p.id === id)!, ctxOf({}))
  expect(hint('review')).toContain('Enter 摺疊已決列')
  expect(hint('fleet')).toContain('Enter 摺疊艦隊列表')
  expect(hint('spend')).toContain('Enter 摺疊花費明細')
  for (const id of ['now', 'dispatch', 'hygiene', 'help']) expect(hint(id)).not.toContain('Enter')
})

test('r11 #10: the collapsed "另有 N 張" row lists the hidden cards by their drawn number, →letter when picked', () => {
  // 已改為雙欄：14 列短框下左欄直接以編號 01/02/03 列出各卡，已選卡帶 →a
  const nav = { ...NO_NAV, cursor: 0, picks: { [decide[2].id]: 0 } }
  const { body } = decidePage.render(ctxOf({}, 14, 100, { decide: nav }))
  const left = body.slice(2).map(r => { const s = text(r); return s.slice(0, s.indexOf(' │ ')) })
  expect(left.find(r => r.startsWith('‣ 01 '))).toBeDefined()
  const row2 = left.find(r => r.startsWith('  02 '))
  const row3 = left.find(r => r.startsWith('  03 '))
  expect(row2).toBeDefined()
  expect(row2).not.toContain('→')
  expect(row3).toContain('→a')
})

test('r11 #11: the spend chart label states unit and source', () => {
  expect(t('v74.f.chart_note', { n: 24 })).toMatch(/USD.*spend-history/)
})

