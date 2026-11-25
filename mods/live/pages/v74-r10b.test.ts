// v74-r10b.test.ts — r10b UX review fixes (carbon / astra on the r8-6 tmux shots).
import { test, expect } from 'claude-code/testing'
import { GLYPHS } from '../../tux/glyphs.ts'
import decideFx from '../fixtures/v74/decide.fixture'
import { decidePage, decideReduce, NO_NAV } from './decide'
import { routeKey } from './keys'
import { renderHelp } from './help'
import { makeT } from '../i18n'
import type { DecideCard, V74Ctx } from '../v74/contract'
import { v74TitleSegs, v74BodyStatusRow, frameHintText } from './frame'
import { PAGES } from './index'
import type { Row } from './rows'
import { renderReview } from './review'
import { NO_SECTIONS, NO_DETAIL } from '../model'
import type { LiveSnapshot } from '../model'

const t = makeT('zh-TW')
const decide = decideFx as DecideCard[]
const v74 = (o: Partial<V74Ctx> = {}): V74Ctx => ({ pm: null, pmFetchedMs: null, decide, todo: [], nav: { cursor: 0, picks: {}, notes: {}, noteMode: false }, ...o })
const ctxOf = (o: Partial<V74Ctx>, rows = 40, cols = 120) => ({ live: null, console: null, size: { cols, rows }, t, nowMs: 1794200000000, v74: v74(o), box: true }) as never
const text = (r: Row): string => r.map(s => s.text).join('')

test('help explains the four band line states', () => {
  const all = renderHelp(ctxOf({})).body.map(text).join('\n')
  for (const phrase of ['⊘ 閒置', '◉ 進行中', '✗ 已失敗結束', '⋯ 等待中']) expect(all).toContain(phrase)
})

test('r10b #1: a picked answer is marked with the answer arrow, never the pending-card diamond', () => {
  const ctx = { ...(ctxOf({}) as object), decide: { ...NO_NAV, cursor: 0, picks: { [decide[0].id]: 0 } } } as never
  const { actions, body } = decidePage.render(ctx)
  const all = [...body, ...actions].map(text).join('\n')
  expect(all).toContain(GLYPHS.structure.answer)
  expect(all).not.toContain(GLYPHS.structure.decisions + ' a')
})

test('r10b #1: the help legend lists the pending diamond, the answer arrow and the proxy-record mark apart', () => {
  const all = renderHelp(ctxOf({}) as never).body.map(text).join('\n')
  expect(all).toContain(GLYPHS.structure.decisions + ' 等你決定')
  expect(all).toContain(GLYPHS.structure.answer + ' 你選的答案')
  expect(all).toContain(GLYPHS.state.done + ' 我替你決定的紀錄')
  expect(all).not.toContain('等你決定 · 你選的答案')
})

// ---- #2 s previews first ----
const picked = { ...NO_NAV, picks: { [decide[0].id]: 1, [decide[1].id]: 0 } }
test('r10b #2: the first s only arms a preview (no send effect, no hold); y sends (r11 #12)', () => {
  const c = ctxOf({})
  const first = decideReduce(picked, { kind: 'submit' }, c, 5)
  expect(first.effect).toBeNull()
  expect(first.nav.armed).toBe(true)
  expect(first.nav.hold).toBeUndefined()
  const second = decideReduce(first.nav, { kind: 'confirm' }, c, 6)
  expect(second.effect?.kind).toBe('send')
  expect(second.nav.armed).toBe(false)
  expect(Object.keys(second.nav.hold ?? {}).sort()).toEqual([decide[0].id, decide[1].id].sort())
})

test('r10b #2: s with nothing picked never arms (negative control)', () => {
  const r = decideReduce(NO_NAV, { kind: 'submit' }, ctxOf({}), 5)
  expect(r.effect).toBeNull()
  expect(r.nav.armed).not.toBe(true)
})

test('r10b #2: Esc cancels the preview (and only then); any other key cancels it and does its own work', () => {
  const c = ctxOf({})
  const armed = decideReduce(picked, { kind: 'submit' }, c, 5).nav
  expect(routeKey('Escape', { page: 'decide', paneFocus: true, focusedButton: false, textMode: false, armed: true })).toEqual({ kind: 'disarm' })
  expect(routeKey('Escape', { page: 'decide', paneFocus: true, focusedButton: false, textMode: false })).toEqual({ kind: 'close' })
  expect(decideReduce(armed, { kind: 'disarm' }, c, 6).nav.armed).toBe(false)
  const moved = decideReduce(armed, { kind: 'move', by: 1 }, c, 6)
  expect(moved.nav.armed).toBe(false)
  expect(moved.nav.cursor).toBe(1)
  // after a cancel the next s starts over: previews again, sends nothing
  expect(decideReduce(moved.nav, { kind: 'submit' }, c, 7).effect).toBeNull()
})

test('r10b #2: the armed send row lists card→letter and how to confirm or cancel; the unarmed row is unchanged', () => {
  const rows = (nav: object) => decidePage.render({ ...(ctxOf({}) as object), decide: nav } as never).actions.map(text).join('\n')
  expect(rows(picked)).toContain('[s] 預覽並送出已選 2 張')
  const armed = rows({ ...picked, armed: true })
  expect(armed).toContain('將送出 2 張')
  expect(armed).toContain('1. ')
  expect(armed).toContain('→ b')
  expect(armed).toContain('y 確認送出')
  expect(armed).not.toContain('Esc')
  expect(armed).not.toContain('[s] 預覽並送出')
})

test('r10b #2: the send feedback after sending stays', () => {
  const { actions } = decidePage.render(ctxOf({ sendResult: { n: 2, left: 1 } }))
  expect(actions.map(text).join('\n')).toContain('已送出 2 張 · 尚有 1 張待決')
})

// ---- #3 the collapsed row keeps the picked answers ----
test('r10b #3: other cards folded into 另有 N 張 still say how many of them hold a picked answer', () => {
  // 已改為雙欄：3 張在 13 列左欄全數展開並帶 →a/→b；超過左欄高度時溢出列保留（已選 P）計數
  const nav = { ...NO_NAV, cursor: 0, picks: { [decide[1].id]: 0, [decide[2].id]: 1 } }
  const leftOf = (rows: number, list: DecideCard[] = decide, dNav = nav) =>
    decidePage.render({ ...(ctxOf({ decide: list }, rows) as object), decide: dNav } as never).body.slice(2).map(r => { const s = text(r); return s.slice(0, s.indexOf(' │ ')) }).join('\n')
  expect(leftOf(40)).toContain('→a')
  expect(leftOf(40)).toContain('→b')
  expect(leftOf(13)).toContain('→a')
  expect(leftOf(13)).toContain('→b')
  const ten = Array.from({ length: 10 }, (_, i) => ({ ...decide[i % decide.length], id: 'd-ten-' + i, title: '卡' + (i + 1) }))
  const hiddenNav = { ...NO_NAV, cursor: 0, picks: { [ten[7].id]: 0, [ten[8].id]: 1 } }
  expect(leftOf(11, ten, hiddenNav)).toContain('下面還有 6 張（已選 2）')
  // negative control: nothing picked among the hidden cards keeps the plain wording
  const plain = leftOf(11, ten, { ...NO_NAV, cursor: 0 })
  expect(plain).toContain('下面還有 6 張')
  expect(plain).not.toContain('已選')
})

// ---- #5 every page title ends in the data age; a failed source says so ----
const titleOf = (id: string, over: Record<string, unknown> = {}, console: unknown = { generated_at_ms: 1794200000000 - 42_000 }): string => {
  const page = PAGES.find(p => p.id === id)!
  const c = { ...(ctxOf({ ages: { todo: 1794200000000 - 9_000 } }) as object), console, ...over } as never
  return v74TitleSegs(page, c, { text: '頁' }).map(s => s.text).join('')
}
test('r10b #5: 花費 and 待辦 titles end in the age like the other pages', () => {
  expect(titleOf('spend')).toMatch(/· 42 秒$/)
  expect(titleOf('todo', { v74: v74({ todo: [], ages: { todo: 1794200000000 - 9_000 } }) })).toMatch(/· 9 秒$/)
  expect(titleOf('review', {}, null)).not.toContain('讀取失敗')
})
test('r10b #5: a source that failed writes 「· 讀取失敗」 in the title (negative: a working one does not)', () => {
  expect(titleOf('todo', { v74: v74({ todo: null }) })).toMatch(/· 讀取失敗$/)
  expect(titleOf('spend', {}, null)).toMatch(/· 讀取失敗$/)
  expect(titleOf('decide', { v74: v74({ decide: null }) })).not.toContain('讀取失敗')
  expect(titleOf('spend')).not.toContain('讀取失敗')
})
const statusOf = (id: string, over: Record<string, unknown> = {}, console: unknown = { generated_at_ms: 1794200000000 - 42_000 }): string | null => {
  const page = PAGES.find(p => p.id === id)!
  const c = { ...(ctxOf({ ages: { todo: 1794200000000 - 9_000 } }) as object), console, ...over } as never
  const row = v74BodyStatusRow(page, c)
  return row === null ? null : text(row)
}
test('r10b #5: simultaneous read failure and staleness (>5m) writes 「· 讀取失敗」 in the title and keeps 「>5 分過舊」 in the body', () => {
  const staleAt = 1794200000000 - 8 * 60_000
  const spendTitle = titleOf('spend', { v74: v74({ errors: { spend: 'usage cli exit 1' } }) }, { generated_at_ms: staleAt })
  expect(spendTitle).toMatch(/· 讀取失敗$/)
  expect(spendTitle).not.toContain('過舊')
  expect(spendTitle).not.toContain('>5')
  const spendBody = statusOf('spend', { v74: v74({ errors: { spend: 'usage cli exit 1' } }) }, { generated_at_ms: staleAt })
  expect(spendBody).not.toBeNull()
  expect(spendBody!).toContain('讀取失敗：usage cli exit 1')
  expect(spendBody!).toContain('>5 分過舊')

  const nowTitle = titleOf('now', { v74: v74({ pm: null, pmFetchedMs: staleAt }) })
  expect(nowTitle).toMatch(/· 讀取失敗$/)
  expect(nowTitle).not.toContain('過舊')
  const nowBody = statusOf('now', { v74: v74({ pm: null, pmFetchedMs: staleAt }) })
  expect(nowBody).not.toBeNull()
  expect(nowBody!).toContain('讀取失敗')
  expect(nowBody!).toContain('>5 分過舊')

  // Negative control: stale (>5m) without read failure keeps age in title and puts >5 分過舊 only in the body
  const staleOnlyTitle = titleOf('spend', {}, { generated_at_ms: staleAt })
  expect(staleOnlyTitle).toMatch(/· 8 分$/)
  expect(staleOnlyTitle).not.toContain('讀取失敗')
  expect(staleOnlyTitle).not.toContain('過舊')
  const staleOnlyBody = statusOf('spend', {}, { generated_at_ms: staleAt })
  expect(staleOnlyBody).not.toBeNull()
  expect(staleOnlyBody!).toContain('>5 分過舊')
  expect(staleOnlyBody!).not.toContain('讀取失敗')
})

// ---- #7 review rows: branch name first, sha only when there is no branch ----
const seats = [{ id: 'G', family: 'G', status: 'reviewed', verdict: 'SHIP-AS-IS' }]
const reviewText = (code: object | null, plan: object | null = null): string => {
  const live = { state: 'ok', text: '', header: '', band: null, pending: [], project_key: 'k', root_run_id: null, link: null, rows: [], gates: null, sections: NO_SECTIONS, review: { code, plan }, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...NO_DETAIL, now_ms: 1794200000000 }, account: { account: undefined, quota: [] } } as unknown as LiveSnapshot
  return renderReview({ live, console: null, size: { cols: 160, rows: 40 }, t, nowMs: 1794200000000 } as never).body.map(text).join('\n')
}
test('r10b #7: a code review row names the branch and not the sha when the producer sends a branch', () => {
  const out = reviewText({ branch: 'feat/tux-sync', phase: null, generation: 1, base: 'a1b2c3d4', head: 'e5f60718', seats, converged: true, at: null })
  expect(out).toContain('feat/tux-sync')
  expect(out).not.toContain('e5f60718')
})
test('r10b #7: without a branch name the row falls back to the sha (negative)', () => {
  const out = reviewText({ phase: null, generation: 1, base: 'a1b2c3d4', head: 'e5f60718', seats, converged: true, at: null })
  expect(out).toContain('e5f60718')
})

// ---- #8 todo with no source: cause and fix on the page, border lists only usable keys ----
test('r10b #8: the todo page names the cause and the fix itself and does not send the reader to another page to look', () => {
  const c = ctxOf({ todo: null }) as never
  const out = PAGES.find(p => p.id === 'todo')!.render(c).body.map(text).join('\n')
  expect(out).toContain('無來源：fleet todo 尚未接線')
  expect(out).toContain('fleet todo --json')
  expect(out).not.toContain('按 1')
})
test('r10b #8: the border of a todo page without cards lists no pick or fold key (negative: with cards it keeps a/b/c)', () => {
  const page = PAGES.find(p => p.id === 'todo')!
  const none = frameHintText(page, ctxOf({ todo: null }) as never)
  expect(none).toContain('捲動')
  expect(none).not.toMatch(/a\/b\/c|Enter 摺疊/)
  expect(frameHintText(page, ctxOf({ todo: [decide[0]] as never }) as never)).toContain('a/b/c')
})
