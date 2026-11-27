// mods/live/pages/decide.ts — page 2 待決 of the pane (plan r2 §2 row 2, §3.1, §3.2, §5; g2 folds A5). One focused card in full (the seat's own cards carry their options), the other cards as a
// folded list, the other seats' cards read-only (each says which seat answers it), and the step / look items "要你做或看". Pure: rows in, rows out; the keys are a pure reducer (decideReduce).
//
// Data: own cards = ctx.live.pending (decision cards; step / look cards are 要你做或看); console cards = ctx.console.cards that the seat does not hold itself; other seats' cards = the console
// exception items of rule T7 (a card another lane opened, seen through the mirror). A page-local view state may ride on the ctx as `decide` (DecideNav); without it the first card is focused, nothing picked.
//
// Import order: pages/frame.ts imports ./index, which imports this file; a test that imports this file first would hit the cycle, so import ./frame (or ./index) first.
//
// Glyph usage: ▸ (GLYPHS.structure.folded) is reserved for folded sections/disclosures; active card cursor uses ‣ (U+2023, EAW=N, width=1).
import type { ConsoleCard } from '../console'
import { questionAfterTitle } from '../cardtitle'
import { DECIDE_UNDO_MS, NO_DECIDE, TRACE_STALE_MIN, TRACE_STALE_MS, decideDialog, decideFillText, decideLine, decidePick, displayWidth, isStepCard, liveAgeMs, recommendedIndex, truncateToWidth } from '../model'
import type { DecideState, DurableAwaiting, LiveDecision, Seg } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { pickedTone, wrapPlain } from '../ui'
import type { KeyAction } from './keys'
import type { Page, PageCtx } from './frame'
import { TINY_FRAME_ROWS, actionRows as frameActionRows, decideFullWidth, narrowAmbiguous } from './layout'
import { brokenRow, pendingMissingReason, pendingSourceMissing, wrapRow, WRAP_HANG } from './rows'
import type { Row } from './rows'
import { DECIDE_COL_SEP_W, DECIDE_COMPACT_MAX_ROWS, DECIDE_DUAL_MIN_COLS, DECIDE_HYSTERESIS, DECIDE_MIN_COL_W, STRIP_SPLIT_COLS, decideColumnWidths, decideLayoutMode } from './layout'
import type { DecideLayoutMode } from './layout'
import { PICK_KEYS, pickIndex, pickKeys } from '../v74/contract'
import { fixedWindow, keyed, keyedGrow, thumbOf } from '../scrollmath'
import type { DecideCard } from '../v74/contract'

export { DECIDE_COL_SEP_W, DECIDE_COMPACT_MAX_ROWS, DECIDE_DUAL_MIN_COLS, DECIDE_HYSTERESIS, DECIDE_MIN_COL_W, decideColumnWidths, decideLayoutMode }
export type { DecideLayoutMode }

// the question segment after a drawn title; none when the question is the title (see questionAfterTitle)
const tailSegs = (c: { title: string; question: string }): Seg[] => { const t = questionAfterTitle(c.title, c.question); return t === '' ? [] : [seg(t)] }

// ---- view state and the key reducer ----
// DecideState (model.ts) carries picks, notes, sent and hold (the 10 s undo window, by card id); the rest is this page's own: which card shows in full, whether the others are folded, the note mode and its buffer, the focused option beyond a)–e)
export type DecideNav = DecideState & { cursor: number; folded: boolean; textMode: boolean; textBuf: string; opt: number | null; detailOffset?: number; armed?: boolean; snap?: string; stale?: boolean; style?: 'D' | 'C'; bgOpen?: boolean; layoutMode?: DecideLayoutMode | null; compactExpanded?: boolean }
export const NO_NAV: DecideNav = { ...NO_DECIDE, cursor: 0, folded: false, textMode: false, textBuf: '', opt: null }
export type DecideCtx = PageCtx & { decide?: DecideNav }
export type DecideEffect = { kind: 'send'; id: string; line: string } | { kind: 'undo'; id: string } | { kind: 'fill'; text: string } | { kind: 'copy_url'; url: string } | null

const LETTERS = 'abcde'
const MAX_OPTS = 5
const CURSOR_MARK = '\u2023' // ‣ (U+2023, EAW=N, width=1): selected card cursor, distinct from fold glyph ▸
const letterOf = (i: number): string => (i < MAX_OPTS ? LETTERS[i] : 'f' + (i + 1))
// R6: the letter a drawn option shows is the key that picks it — both read one call of contract.pickKeys on the card's options.
// Beyond the pick keys the legacy lettering stays: letterOf in the lists, the old digit on the held/summary lines.
const pickLetter = (c: { options: { label: string }[] }, at: number): string => pickKeys(c.options)[at] || letterOf(at)
const pickDigit = (c: { options: { label: string }[] }, at: number): string => pickKeys(c.options)[at] || String(PICK_KEYS[at] ?? at + 1)

type Item = { kind: 'own'; d: LiveDecision } | { kind: 'con'; c: ConsoleCard }
type Far = { id: string; title: string; seat: string }
type Model = { all: Item[]; steps: LiveDecision[]; far: Far[] }

const idOf = (it: Item): string => (it.kind === 'own' ? it.d.id ?? '' : it.c.id)

// every card of this page: the seat's own decision cards, then the console cards it does not hold
function modelOf(ctx: PageCtx): Model {
  const v74 = v74Cards(ctx)
  if (v74 !== null) return { all: v74.map((c): Item => ({ kind: 'own', d: cardToLive(c) })), steps: [], far: [] }
  const pending = ctx.live === null ? [] : ctx.live.pending
  const own = pending.filter(d => !isStepCard(d))
  const held = new Set(own.map(d => d.id))
  const cons = ctx.console === null || ctx.console.cards === null ? [] : ctx.console.cards.filter(c => !held.has(c.id))
  const far: Far[] = []
  if (ctx.console !== null) {
    for (const it of ctx.console.items) {
      if (it.kind !== 'exception' || !it.id.startsWith('exc:T7:')) continue
      const line = ctx.console.lines === null || it.line_id === null ? undefined : ctx.console.lines.find(l => l.line_id === it.line_id)
      far.push({ id: /\bd-[0-9a-z-]+/.exec(it.text)?.[0] ?? it.id, title: it.title, seat: line?.lead_display ?? '' })
    }
  }
  // N1: priority order, then the longest wait first: the seat's own cards (answerable here) before the console cards, each group oldest first, so the default focus is the card
  // that has waited longest (the one 現況 names as 最舊 when it is a console card); a card with no open time keeps its place after the dated ones of its group
  const byAge = <X>(list: X[], at: (x: X) => number | null): X[] =>
    list.map((x, i) => ({ x, i, at: at(x) })).sort((a, b) => (a.at === null ? (b.at === null ? a.i - b.i : 1) : b.at === null ? -1 : a.at - b.at || a.i - b.i)).map(e => e.x)
  const all: Item[] = [...byAge(own, d => openedMs(d, ctx)).map((d): Item => ({ kind: 'own', d })), ...byAge(cons, c => c.opened_at_ms).map((c): Item => ({ kind: 'con', c }))]
  return { all, steps: pending.filter(isStepCard), far }
}


// ---- v7.4 (S3): the cards come from ctx.v74.decide (fleet decision list); the send / undo path stays decidebatch.ts / decideundo.ts, which read them as LiveDecision ----
export const cardToLive = (c: DecideCard): LiveDecision => ({
  id: c.id, title: c.title, question: c.question, background: c.background, options: c.options.map(o => ({ label: o.label, description: o.detail })),
  recommendation: c.options.find(o => o.recommended)?.label ?? null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null,
  stale: false, age_s: null, origin: null, orphaned: false, kind: 'decide',
})
// null = the v7.4 source is not on the ctx (legacy draw) or broken; [] = a working source with no open card
export const v74Cards = (ctx: PageCtx): DecideCard[] | null => ctx.v74?.decide ?? null
// the send pool: the seat's own pending cards plus the v7.4 list cards it does not already hold (the same card id counts once)
export const v74Pool = (pending: readonly LiveDecision[], feed: readonly DecideCard[] | null): LiveDecision[] => {
  const held = new Set(pending.map(d => d.id))
  return [...pending, ...(feed ?? []).filter(c => !held.has(c.id)).map(cardToLive)]
}

// The preview is bound to the whole send list. One item per card that would go out: its id, its version (a hash of what the owner read: question, background, option labels), the letter and the note.
const djb = (x: string): string => { let h = 5381; for (const ch of x) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0; return h.toString(36) }
export const cardVersion = (d: LiveDecision): string => djb([d.question, d.background ?? '', ...d.options.map(o => o.label)].join('\u0001'))
export function decideReadySig(nav: DecideNav, ctx: PageCtx): string {
  const m = modelOf(ctx)
  const items = m.all.flatMap(it => (it.kind === 'own' && it.d.id !== null && nav.hold?.[it.d.id] === undefined && !(nav.sent[it.d.id] !== undefined && nav.fixing?.[it.d.id] === undefined) && decideLine(it.d, nav) !== null
    ? [[it.d.id, cardVersion(it.d), decidePick(it.d, nav), nav.notes[it.d.id] ?? ''] as const] : []))
  return JSON.stringify(items)
}
// a preview that is open but whose list no longer matches the frozen one
export const previewStale = (nav: DecideNav, ctx: PageCtx): boolean => nav.armed === true && nav.snap !== undefined && (nav.stale === true || nav.snap !== decideReadySig(nav, ctx))

const clampCursor = (nav: DecideNav, n: number): number => (n === 0 ? 0 : Math.max(0, Math.min(n - 1, nav.cursor)))

// one key of routeKey's table applied to the page state. The host calls it with the cards of the current draw (`cards` = the seat's own decision cards and the console cards, in page order), and does the effect.
export function decideReduce(nav: DecideNav, key: KeyAction, ctx: PageCtx, nowMs: number): { nav: DecideNav; effect: DecideEffect } {
  const m = modelOf(ctx)
  const cursor = clampCursor(nav, m.all.length)
  const cur = m.all[cursor]
  const d = cur !== undefined && cur.kind === 'own' && cur.d.id !== null ? cur.d : null
  const same = (patch: Partial<DecideNav>): { nav: DecideNav; effect: DecideEffect } => ({ nav: { ...nav, cursor, ...patch }, effect: null })
  const heldNow = d !== null && d.id !== null && nav.hold?.[d.id] !== undefined
  const sentNow = d !== null && d.id !== null && nav.sent[d.id] !== undefined && nav.fixing?.[d.id] === undefined
  if (key.kind === 'disarm') return same({ armed: false, snap: undefined, stale: false })
  // A pick (or a saved note) under an open preview does not close it: the preview stays and is stale, y is refused with the reason until `s` previews again
  if (nav.armed === true && nav.snap !== undefined && (key.kind === 'pick' || key.kind === 'text_save')) {
    const r = decideReduce({ ...nav, armed: false, snap: undefined, stale: false }, key, ctx, nowMs)
    return { nav: { ...r.nav, armed: true, snap: nav.snap, stale: nav.stale === true }, effect: r.effect }
  }
  if (nav.armed === true && key.kind !== 'submit' && key.kind !== 'confirm') return decideReduce({ ...nav, armed: false, snap: undefined, stale: false }, key, ctx, nowMs) // any other key cancels the send preview, then does its own work
  if (key.kind === 'style') return same({ style: (nav.style ?? 'D') === 'D' ? 'C' : 'D', bgOpen: false, detailOffset: 0 })
  const compactMode = (ctx.maxRows ?? ctx.size.rows) < DECIDE_COMPACT_MAX_ROWS
  if (key.kind === 'expand') {
    if (nav.bgOpen) return same({ bgOpen: false, detailOffset: 0 })
    if (compactMode && nav.compactExpanded === true) return same({ compactExpanded: false, detailOffset: 0 })
    if (compactMode && nav.compactExpanded !== true) return same({ compactExpanded: true, detailOffset: 0 })
    if (d === null) return same({})
    if (!d.background) return same({})
    const bgRaw = d.background
    const bgLines = bgRaw.split('\n')
    const bgLabelW = displayWidth('  ' + ctx.t('v74.d.bg') + '  ')
    const hasMoreBg = bgLines.length > 1 || displayWidth(bgLines[0]) > ctx.size.cols - bgLabelW
    return hasMoreBg ? same({ bgOpen: true, detailOffset: 0 }) : same({})
  }
  if (v74Cards(ctx) !== null && key.kind === 'move') return same({ cursor: Math.min(Math.max(0, m.all.length - 1), Math.max(0, cursor + key.by)), opt: null, detailOffset: 0, bgOpen: false })
  if (v74Cards(ctx) !== null && key.kind === 'cursor') return same({ cursor: Math.min(Math.max(0, m.all.length - 1), Math.max(0, key.at)), opt: null, detailOffset: 0, bgOpen: false, ...(compactMode ? { compactExpanded: true } : {}) })
  if (v74Cards(ctx) !== null && compactMode && key.kind === 'fold') return same({ compactExpanded: nav.compactExpanded !== true, detailOffset: 0, bgOpen: false })
  if (v74Cards(ctx) !== null && key.kind === 'confirm' && nav.armed !== true) return same({}) // y means nothing outside the send preview
  if (v74Cards(ctx) !== null && (key.kind === 'submit' || key.kind === 'confirm')) { // s only opens (or redraws) the preview; y sends every answered card of the FROZEN preview list
    const ready = m.all.flatMap(it => (it.kind === 'own' && it.d.id !== null && nav.hold?.[it.d.id] === undefined && !(nav.sent[it.d.id] !== undefined && nav.fixing?.[it.d.id] === undefined) ? [it.d] : []))
      .flatMap(c => { const line = decideLine(c, nav); return line === null ? [] : [{ id: c.id as string, line }] })
    if (ready.length === 0) return same({ armed: false, snap: undefined, stale: false })
    const sig = decideReadySig(nav, ctx)
    if (nav.armed !== true || key.kind === 'submit') return same({ armed: true, snap: sig, stale: false })
    if (nav.snap !== sig) return same({ armed: true, stale: true }) // the picks, notes or a card changed under the preview: y is refused until `s` previews again
    return { nav: { ...nav, cursor, armed: false, snap: undefined, stale: false, hold: { ...(nav.hold ?? {}), ...Object.fromEntries(ready.map(r => [r.id, nowMs])) } }, effect: { kind: 'send', id: ready[0].id, line: ready[0].line } }
  }
  if (key.kind === 'copy_url') { // wide band `g`: the first URL in the card's background or question; no URL, no effect
    const url = d === null ? null : /https?:\/\/\S+/.exec(`${d.background ?? ''}\n${d.question}`)?.[0] ?? null
    return url === null ? same({}) : { nav: { ...nav, cursor }, effect: { kind: 'copy_url', url } }
  }
  switch (key.kind) {
    case 'text': {
      if (!nav.textMode) return same({})
      if (key.ch === 'Backspace') return same({ textBuf: [...nav.textBuf].slice(0, -1).join('') })
      return [...key.ch].length === 1 ? same({ textBuf: nav.textBuf + key.ch }) : same({})
    }
    case 'text_save': return d === null || d.id === null ? same({ textMode: false, textBuf: '' }) : same({ textMode: false, textBuf: '', notes: { ...nav.notes, [d.id]: nav.textBuf } })
    case 'text_cancel': return same({ textMode: false, textBuf: '' })
    case 'note': return d === null || d.id === null || heldNow || sentNow ? same({}) : same({ textMode: true, textBuf: nav.notes[d.id] ?? '', opt: null })
    case 'pick': {
      // R6: the pressed key names the letter, the letter names the option (contract.pickIndex); a key the handler does not
      // accept (the legacy 4th pick) keeps its position
      if (d === null || d.id === null || heldNow || sentNow || decideDialog(d)) return same({})
      const at = pickIndex(d.options, key.index)
      if (at < 0 || at >= Math.min(d.options.length, MAX_OPTS)) return same({})
      return same({ picks: { ...nav.picks, [d.id]: at }, opt: null })
    }
    case 'move': {
      if (d === null || d.options.length <= MAX_OPTS) return same({})
      const last = d.options.length - 1
      const next = key.by === 1 ? (nav.opt === null ? MAX_OPTS : Math.min(last, nav.opt + 1)) : nav.opt === null || nav.opt <= MAX_OPTS ? null : nav.opt - 1
      return same({ opt: next })
    }
    case 'submit': {
      if (d === null || d.id === null || heldNow || sentNow) return same({})
      if (nav.opt !== null && decidePick(d, nav) !== nav.opt) return same({ picks: { ...nav.picks, [d.id]: nav.opt } }) // an old 6th option: the first Enter selects it, the second sends
      const line = decideLine(d, nav)
      if (line === null) return same({})
      return { nav: { ...nav, cursor, hold: { ...(nav.hold ?? {}), [d.id]: nowMs } }, effect: { kind: 'send', id: d.id, line } }
    }
    case 'undo': {
      if (d === null || d.id === null || nav.hold?.[d.id] === undefined || nowMs - nav.hold[d.id] >= DECIDE_UNDO_MS) return same({})
      const hold = { ...nav.hold }
      delete hold[d.id]
      return { nav: { ...nav, cursor, hold }, effect: { kind: 'undo', id: d.id } }
    }
    case 'prev': return same({ cursor: Math.max(0, cursor - 1), opt: null, detailOffset: 0 })
    case 'next': return same({ cursor: Math.min(Math.max(0, m.all.length - 1), cursor + 1), opt: null, detailOffset: 0 })
    case 'fold': return same({ folded: !nav.folded })
    case 'fill': {
      const text = d === null ? null : decideFillText(d, nav)
      return text === null ? same({}) : { nav: { ...nav, cursor }, effect: { kind: 'fill', text } }
    }
    default: return same({})
  }
}

// ---- drawing ----
const seg = (text: string, o: Partial<Seg> = {}): Seg => ({ text, ...o })
const dimSeg = (text: string): Seg => ({ text, dim: true })
const widthOf = (segs: Seg[]): number => segs.reduce((w, s) => w + displayWidth(s.text), 0)

// 等你動手: the durable store's answered cards that still wait on the operator's own step (status awaiting_operator_action,
// scripts/open-decision.js operator_steps). A bottom block of the page (drawn as action rows: under the card list and the
// send preview, above the footer, inside the frame's height budget): a heading row, then per card a title row (the title,
// else the question) and every step in full as a numbered list. A long step wraps onto continuation rows under its text by
// display width (CJK = 2), never cut. No buttons, no keys. `cap` = the action rows the frame can still afford; a card shows
// whole or not at all (a hint row names the hidden ones). Zero cards: no rows.
// One awaiting card as drawn: its title, then every step whole (wrapped, never cut). The frame wraps a read page's body at
// min(80, cols), so the rows are wrapped here first and the frame adds none.
function awaitingCardRows(c: DurableAwaiting, ctx: PageCtx): Row[] {
  const cols = Math.max(8, Math.min(80, ctx.size.cols))
  const title = (c.title ?? '').trim() !== '' ? c.title : c.question
  const rows: Row[] = wrapRow([seg('  ' + title)], cols, 2)
  c.operator_steps.forEach((s, i) => {
    const prefix = '  ' + String(i + 1) + '. '
    rows.push(...wrapRow([seg(prefix + s)], cols, displayWidth(prefix)))
  })
  return rows
}
// The body rows the frame leaves a page (frame.ts frameRows: head, the foot = key-hint border row + strip, the border row
// dropped at <= TINY_FRAME_ROWS, and the action rows). The page cuts its own content to this so the frame never cuts the tail.
// The rows as the frame will draw them: a reading page's body wraps at min(80, cols) with a hanging indent (frame.ts layout), so a
// page that cuts its own content counts the wrapped rows, not the rows it returned.
function frameWrap(rows: Row[], ctx: PageCtx): Row[] {
  const width = decideFullWidth({ boxed: ctx.v74 !== undefined && ctx.box === true, effMaxRows: ctx.maxRows ?? ctx.size.rows, compactExpanded: ctx.decide?.compactExpanded === true, bodyCols: ctx.bodyColumns ?? ctx.size.cols, layoutMode: ctx.decide?.layoutMode ?? null, styleC: ctx.decide?.style === 'C' }) ? ctx.size.cols : Math.min(80, ctx.size.cols)
  return rows.flatMap(x => {
    const lead = /^ */.exec(x.map(sg => sg.text).join(''))?.[0].length ?? 0
    return wrapRow(x, width, Math.max(WRAP_HANG, Math.min(lead, Math.max(0, width - 4))))
  })
}
export function frameBodyRoom(ctx: PageCtx, actions: number): number {
  const H = ctx.size.rows
  const strip = ctx.size.cols < STRIP_SPLIT_COLS ? 2 : 1
  return Math.max(0, H - 1 - (H <= TINY_FRAME_ROWS ? strip : strip + 1) - actions)
}
// A card with no operator step has nothing to do: it is not drawn and not counted.
const withSteps = (a: DurableAwaiting[] | null | undefined): DurableAwaiting[] | null | undefined => a?.filter(c => c.operator_steps.length > 0)
export function awaitingBlockRows(awaitingAll: DurableAwaiting[] | null | undefined, ctx: PageCtx, cap: number): Row[] {
  const awaiting = withSteps(awaitingAll)
  if (awaiting === null || awaiting === undefined || awaiting.length === 0 || cap < 1) return []
  const cardRowsOf = (c: DurableAwaiting): Row[] => awaitingCardRows(c, ctx)
  const out: Row[] = [[dimSeg(ctx.t('v74.d.await_head', { n: awaiting.length }))] as Row]
  let at = 0
  while (at < awaiting.length) {
    const cr = cardRowsOf(awaiting[at])
    if (out.length + cr.length > cap) break
    out.push(...cr)
    at++
  }
  const left = awaiting.length - at
  if (left > 0 && out.length + 1 <= cap) out.push([dimSeg(ctx.t('v74.d.pv_more', { n: left }))] as Row)
  return out
}
// The block lives at the bottom of the BODY, directly above the action area (R1: information grows upward from the action
// area; the action area is 4-6 rows and cannot hold full steps). It takes at most a third of the pane, and never so much that
// the page would drop to the compact (< DECIDE_COMPACT_MAX_ROWS) layout or to the 4-row action area (rows < 32).
const AWAIT_KEEP_CARD = 3
export function awaitingBodyCap(ctx: PageCtx, awaitingAll?: DurableAwaiting[] | null, room?: number): number {
  const awaiting = withSteps(awaitingAll)
  const rows = ctx.maxRows ?? ctx.size.rows
  const third = Math.floor(rows / 3)
  const keepCompact = rows >= DECIDE_COMPACT_MAX_ROWS ? rows - DECIDE_COMPACT_MAX_ROWS : third
  const keepActions = ctx.size.rows >= 32 ? ctx.size.rows - 32 : third
  const base = Math.max(0, Math.min(third, keepCompact, keepActions))
  if (awaiting === null || awaiting === undefined || awaiting.length === 0 || room === undefined) return base
  // canary 2 (b67c04a2e, host box 13 / 17 rows): a third of a small box never holds one card's steps. The block grows to the
  // first card whole (heading + its rows) while the card box above keeps AWAIT_KEEP_CARD rows (the selected card's title and an
  // option), and keeps at least its heading row while the room has two rows.
  const need = 1 + awaitingCardRows(awaiting[0], ctx).length
  return Math.min(room, Math.max(base, Math.min(need, room - AWAIT_KEEP_CARD), room >= 2 ? 1 : 0))
}
// The page drawn with `k` fewer rows (the box renderers size their body from ctx.size.rows / maxRows), for the block below it.
const shrunk = <C extends PageCtx>(ctx: C, k: number): C => (k === 0 ? ctx : { ...ctx, size: { ...ctx.size, rows: ctx.size.rows - k }, ...(ctx.maxRows === undefined ? {} : { maxRows: ctx.maxRows - k }) })
// How many options of `c` are on screen in these rows (whitespace and box rules ignored, so a wrapped label still counts).
function optionsShown(rows: Row[], c: DecideCard): number {
  const letters = (x: string): string => x.replace(/[^\p{L}\p{N}]+/gu, '')
  const flat = letters(rows.map(r => r.map(x => x.text).join('')).join(''))
  return c.options.filter(o => flat.includes(letters(o.label))).length
}
const WIDE = 100 // columns from which the cards use the wide form (labelled rows, the executor at the right)

function truncateSegs(row: Row, cols: number): Row {
  if (cols <= 0) return [seg('')]
  if (widthOf(row) <= cols) return row
  const out: Row = []
  let used = 0
  for (const s of row) {
    const w = displayWidth(s.text)
    if (used + w <= cols) { out.push(s); used += w; continue }
    const room = cols - used
    if (room > 0) out.push({ ...s, text: truncateToWidth(s.text, room) })
    break
  }
  return out.length === 0 ? [seg('')] : out
}

// left segments (cut with `…` when too wide), then `right` fixed at the right edge `cols`, never wrapped (R11)
function leftRight(left: Seg[], right: string, cols: number, gap = 2): Row {
  if (right === '') return truncateSegs(left, cols)
  const rw = displayWidth(right)
  if (cols <= rw + gap) return truncateSegs(left, cols)
  const cut = truncateSegs(left, cols - gap - rw)
  const lw = widthOf(cut)
  return [...cut, seg(' '.repeat(Math.max(gap, cols - lw - rw))), dimSeg(right)]
}

const ageOf = (ctx: PageCtx, ms: number | null): string => {
  if (ms === null) return ''
  const min = Math.max(0, Math.floor((ctx.nowMs - ms) / 60000))
  if (min < 60) return ctx.t('page.decide.age_m', { n: min })
  const h = Math.floor(min / 60)
  return h < 24 ? ctx.t('page.decide.age_h', { n: h }) : ctx.t('page.decide.age_d', { n: Math.floor(h / 24) })
}
const openedMs = (d: LiveDecision, ctx: PageCtx): number | null => (d.age_s !== null ? ctx.nowMs - d.age_s * 1000 : d.opened_at === null ? null : Date.parse(d.opened_at) || null)

function header(label: string, wide: boolean): Row {
  const rule = GLYPHS.structure.rule
  return [dimSeg(rule + rule + ' ' + label + (label.endsWith('）') ? '' : ' ') + rule.repeat(wide ? 32 : 2))]
}
// a labelled row of the wide form: two blanks of indent, the label in 4 cells, three blanks, then the text
const labelled = (label: string, text: string, rest: Seg[] = []): Row => [seg('  '), dimSeg(label), seg('   ' + text), ...rest]

function optionSegs(d: LiveDecision, i: number, nav: DecideNav, ctx: PageCtx): Seg[] {
  const rec = recommendedIndex(d) === i
  const picked = decidePick(d, nav) === i
  const label = i < MAX_OPTS ? d.options[i].label : ctx.t('page.decide.opt_n', { n: i + 1, label: d.options[i].label })
  // G11: the option is a Button (press `key:<letter>`, the pane turns it into the key's action) so it works by click where the pane cannot take the keyboard; the old 6th-and-later options (f6..) keep plain text
  const key = pickKeys(d.options)[i] || letterOf(i)
  const press = i < MAX_OPTS ? { press: 'key:' + key } : {}
  const out: Seg[] = [seg('[' + key + '] ' + label, picked ? { ...pickedTone(), ...press } : press)]
  if (rec) out.push(seg(' ' + GLYPHS.structure.recommend, { color: PALETTE.attention, ...press }))
  return out
}
function optionRows(d: LiveDecision, nav: DecideNav, ctx: PageCtx, wide: boolean): Row[] {
  const n = d.options.length
  const segs = d.options.map((_, i) => optionSegs(d, i, nav, ctx))
  const lead = wide ? '  ' : ''
  if (n === 0) return []
  if (n <= 2) {
    const sep = wide ? '    ' : '   '
    return [[seg(lead), ...segs.flatMap((s, i) => (i === 0 ? s : [seg(sep), ...s]))]]
  }
  if (wide) return segs.map(s => [seg(lead), ...s])
  const rows: Row[] = []
  const five = Math.min(n, MAX_OPTS)
  for (let i = 0; i < five; i += 3) rows.push(segs.slice(i, Math.min(i + 3, five)).flatMap((s, k) => (k === 0 ? s : [seg('  '), ...s])))
  for (let i = MAX_OPTS; i < n; i++) rows.push(segs[i]) // an old card's 6th option and beyond: one row each
  return rows
}

function noteRow(d: LiveDecision, nav: DecideNav, ctx: PageCtx, wide: boolean): Row[] {
  const note = d.id === null ? '' : nav.notes[d.id] ?? ''
  const k = ctx.t('page.decide.k_note')
  if (nav.textMode) return [wide ? labelled(k, nav.textBuf + '_') : [dimSeg(k), seg(' ' + nav.textBuf + '_')]]
  if (note !== '') return [wide ? labelled(k, note) : [dimSeg(k), seg(' ' + note)]]
  return wide ? [labelled(k, ctx.t('page.decide.note_ph'))] : []
}

// the card in full: the seat's own card with its options
function ownCard(d: LiveDecision, pos: string, nav: DecideNav, ctx: PageCtx, wide: boolean, readOnly = false, compactOptions = false): Row[] {
  const { t } = ctx
  const cols = ctx.size.cols
  const who = d.source ?? ''
  const age = ageOf(ctx, openedMs(d, ctx))
  const old = d.options.length > MAX_OPTS ? t('page.decide.old', { n: d.options.length }) : ''
  const out: Row[] = []
  const mark = seg(CURSOR_MARK + ' ', { color: PALETTE.here })
  const id0 = d.id === null ? '' : d.id + ' '
  // Z4: reserve the progress/age suffix before shortening the question.
  const progress = '(' + [pos, age].filter(Boolean).join(' · ') + ')'
  if (wide) out.push(leftRight([mark, seg(id0 + ' ' + d.question + old)], (who === '' ? '' : t('page.decide.exec', { who }) + '  ') + progress, cols))
  else out.push(leftRight([mark, seg(d.question)], progress, cols), [dimSeg('  ' + [id0.trim(), who].filter(Boolean).join(' · ') + old)])
  const sent = d.id !== null && nav.sent[d.id] !== undefined && nav.fixing?.[d.id] === undefined
  const held = d.id !== null && nav.hold?.[d.id] !== undefined
  const pick = decidePick(d, nav)
  if (sent || held) {
    const what = pick !== null ? t('page.decide.sent_opt', { k: letterOf(pick), label: d.options[pick].label }) : t('page.decide.sent_free', { text: d.id === null ? '' : nav.notes[d.id] ?? '' })
    out.push(wide ? [seg('  '), seg(what)] : [seg(what)])
    return out
  }
  if (d.background !== null) out.push(wide ? labelled(t('page.decide.k_bg'), d.background) : [dimSeg(t('page.decide.k_bg')), seg(' ' + d.background)])
  const blocks = d.blocks ?? '—' // W3: absence is explicit; the answer area's labels stay stable.
  out.push(wide ? labelled(t('page.decide.k_blocks'), blocks) : [dimSeg(t('page.decide.k_blocks')), seg(' ' + blocks)])
  if (decideDialog(d)) out.push([seg(wide ? '  ' : ''), dimSeg(t('page.decide.in_dialog'))])
  else {
    if (readOnly && !compactOptions) d.options.forEach((o, i) => {
      out.push([seg((wide ? '  ' : '') + '[' + letterOf(i) + '] ' + o.label + (recommendedIndex(d) === i ? ' ' + GLYPHS.structure.recommend : ''))])
      if (o.description !== '') out.push([dimSeg((wide ? '      ' : '    ') + o.description)])
    })
    else out.push(...optionRows(d, nav, ctx, wide).map(r => readOnly ? r.map(({ press: _press, ...s }) => s) : r))
  }
  if (d.recommendation !== null) out.push(wide ? labelled(t('page.decide.k_advice'), d.recommendation) : [dimSeg(t('page.decide.k_advice')), seg(' ' + d.recommendation)])
  if (readOnly) out.push(wide ? labelled(t('page.decide.k_note'), '—') : [dimSeg(t('page.decide.k_note')), seg(' —')]) // U2: the destination belongs only in the action row.
  else if (d.options.length <= MAX_OPTS) out.push(...noteRow(d, nav, ctx, wide))
  else if (nav.textMode) out.push(...noteRow(d, nav, ctx, wide))
  return out
}

// Y2: the same answer area in PM order, with inert options and the answering seat.
function conCard(c: ConsoleCard, pos: string, ctx: PageCtx, wide: boolean): Row[] {
  const options = c.options ?? []
  const recommendation = c.recommendation ?? options.find(o => o.recommended === true)?.label ?? null
  return ownCard({ id: c.id, title: null, question: c.question, source: c.executor_display,
    opened_at: null, age_s: Math.max(0, (ctx.nowMs - c.opened_at_ms) / 1000), background: c.background ?? null, blocks: c.blocks ?? null,
    options, recommendation, why: null, not_authorized: null, stale: false, origin: null, orphaned: false }, pos, NO_NAV, ctx, wide, true)
}

// W3: keep the PM-ordered answer summary visible in a short host allocation.
// Full text remains reachable through click targets, in bounded pages; counts
// below describe hidden detail rows only, never bus card/line/pool totals.
function cardWindow(cur: Item, pos: string, nav: DecideNav, ctx: PageCtx, wide: boolean): Row[] {
  const full = (cur.kind === 'own' ? ownCard(cur.d, pos, nav, ctx, wide) : conCard(cur.c, pos, ctx, wide))
    .flatMap(r => wrapRow(r, ctx.size.cols))
  const room = Math.max(1, ctx.size.rows - 2 - (ctx.size.cols < STRIP_SPLIT_COLS ? 2 : 1))
  if (full.length <= room) return full
  const take = Math.max(1, room - 1)
  const offset = Math.max(0, Math.min(nav.detailOffset ?? 0, full.length))
  const more = (at: number): Seg => seg(GLYPHS.structure.behind + ' ' + ctx.t('page.decide.details', { n: full.length - at }), { press: 'decide:detail:' + (at + 1) })
  const back: Seg = seg(GLYPHS.structure.folded + ' ' + ctx.t('page.decide.details_back'), { press: 'decide:detail:0' })
  if (offset > 0) {
    const start = offset - 1
    const end = Math.min(full.length, start + take)
    return [...full.slice(start, end), [back, ...(end < full.length ? [seg('  '), more(end)] : [])]]
  }
  const d = cur.kind === 'own' ? cur.d : { ...cur.c, source: cur.c.executor_display, age_s: Math.max(0, (ctx.nowMs - cur.c.opened_at_ms) / 1000), opened_at: null, id: cur.c.id }
  const compact = { ...d, background: d.background == null ? null : truncateToWidth(d.background, Math.max(4, ctx.size.cols - 7)),
    blocks: d.blocks == null ? null : truncateToWidth(d.blocks, Math.max(4, ctx.size.cols - 7)),
    recommendation: d.recommendation == null ? null : truncateToWidth(d.recommendation, Math.max(4, ctx.size.cols - 7)),
    options: (d.options ?? []).map(o => ({ ...o, description: '', label: truncateToWidth(o.label, Math.max(4, Math.floor(ctx.size.cols / Math.min(3, (d.options ?? []).length)) - 12)) })) } as LiveDecision
  const summary = ownCard(compact, pos, nav, ctx, false, cur.kind === 'con', true)
  summary.splice(1, 1) // the focused title already identifies the card; reclaim the separate id/seat row.
  return [...summary.slice(0, take), [more(0)]]
}

// Keep a visible gutter between each list question and its owner/age column;
// truncate the title before it reaches that column, leaving the age at the edge.
const OTHER_CARD_GUTTER = 4
function otherRow(id: string, title: string, who: string, age: string, ctx: PageCtx, wide: boolean): Row {
  const tail = [who, age].filter(s => s !== '').join(' · ')
  if (wide) return leftRight([seg('  ' + id + '  ' + title)], tail, ctx.size.cols, OTHER_CARD_GUTTER)
  if (age === '') return [seg(truncateToWidth(id + ' ' + title, ctx.size.cols))]
  const right = '· ' + age
  const rw = displayWidth(right)
  if (ctx.size.cols <= rw + 2) return [seg(truncateToWidth(id + ' ' + title, ctx.size.cols))]
  const leftText = truncateToWidth(id + ' ' + title, ctx.size.cols - 1 - rw)
  const gap = Math.max(1, ctx.size.cols - displayWidth(leftText) - rw)
  return [seg(leftText + ' '.repeat(gap)), dimSeg(right)]
}

// A10: a broken-source reason is never cut with `…`: it wraps onto further red rows (the frame's body overflow gives way to other content first, never the reason)
const brokenRows = (text: string, cols: number): Row[] => wrapPlain(text, cols, cols).map(l => brokenRow(l))
const noSource = (ctx: PageCtx, id: string): Row => brokenRow(GLYPHS.state.failed + ' ' + ctx.t(id))

function render(ctx0: PageCtx): { body: Row[]; actions: Row[] } {
  if (ctx0.v74 !== undefined) return renderV74(ctx0)
  // The pane's 待決 page is retired: the O4 band shell is the only pending-decision panel. The tab and its key stay.
  // One action row, so a short frame still shows it (an empty action area would be replaced by the old 「待決 N 張卡等你」 line).
  return { body: [], actions: [[seg(ctx0.t('shell.on_band'))]] }
  const ctx = ctx0 as DecideCtx
  const { t } = ctx
  const nav = ctx.decide ?? NO_NAV
  const wide = ctx.size.cols >= WIDE
  const m = modelOf(ctx)
  const noPendingSrc = pendingSourceMissing(ctx)
  const body: Row[] = []
  let focusEnd = 0
  if (noPendingSrc) body.push(...wrapRow(brokenRow(GLYPHS.state.failed + ' ' + t('page.decide.pending_no_source', { why: pendingMissingReason(ctx, t) })), ctx.size.cols))
  // §5: a source that is stale or missing says so in red, with its reason
  if (ctx.live === null) body.push(noSource(ctx, 'page.decide.nosrc_live'))
  else if (ctx.live.state !== 'ok') body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('page.decide.stale_live', { why: ctx.live.header }), ctx.size.cols))
  if (ctx.console !== null) {
    const src = ctx.console.sources.cards
    if (src !== undefined && src.state !== 'ok') body.push(...brokenRows(GLYPHS.state.failed + ' ' + t('frame.src_' + src.state, { name: t('console.command.src.cards'), min: src.at_ms === null ? '-' : String(Math.max(0, Math.floor((ctx.nowMs - src.at_ms) / 60000))) }), ctx.size.cols))
    else if (ctx.console.cards === null) body.push(noSource(ctx, 'page.decide.nosrc_cards'))
  }

  const cursor = clampCursor(nav, m.all.length)
  const cur = m.all[cursor]
  const actions: Row[] = []
  const roomy = ctx.size.rows >= 32
  const total = m.all.length
  const hasOwn = cur !== undefined && cur.kind === 'own'

  // R4-3: like fleet/quota, the only content slot carries the focused fact, not controls.
  const available = ctx.size.rows - 1 - (ctx.size.cols < STRIP_SPLIT_COLS ? 2 : 1)
  if (available === 1 && cur !== undefined) {
    const title = cur.kind === 'own' ? cur.d.title ?? cur.d.question : cur.c.question
    const age = ageOf(ctx, cur.kind === 'own' ? openedMs(cur.d, ctx) : cur.c.opened_at_ms)
    const position = t('page.decide.position', { n: cursor + 1, total })
    return { body: [], actions: [leftRight([seg(CURSOR_MARK + ' ', { color: PALETTE.here }), seg(title)], position + (age === '' ? '' : ' · ' + age), ctx.size.cols)] }
  }

  if (cur === undefined) {
    if (!noPendingSrc && ctx.live !== null) body.push([seg(GLYPHS.state.pending + ' '), dimSeg(t('page.decide.none_cards'))])
  } else {
    const pos = String(cursor + 1) + '/' + String(total)
    body.push(...cardWindow(cur, pos, nav, ctx, wide))
    focusEnd = body.length
    if (wide) body.push([seg('')])
    const rest = m.all.filter((_, i) => i !== cursor)
    const label = rest.length === 0 ? t('page.decide.sec_others_plain', { n: 0 }) : nav.folded ? t('page.decide.sec_others_folded', { n: rest.length }) : t('page.decide.sec_others_open', { n: rest.length })
    body.push(header(label, wide))
    if (!nav.folded) {
      for (const it of rest) {
        if (it.kind === 'own') body.push(otherRow(it.d.id ?? '', it.d.title ?? it.d.question, it.d.source ?? '', ageOf(ctx, openedMs(it.d, ctx)), ctx, wide))
        else body.push(otherRow(it.c.id, it.c.question, it.c.executor_display ?? '', ageOf(ctx, it.c.opened_at_ms), ctx, wide))
      }
    }
  }

  // the other seats' cards: read-only, each says which seat answers it
  if (ctx.console === null) {
    body.push(header(t('page.decide.sec_far_empty'), wide), noSource(ctx, 'page.decide.nosrc_console'))
  } else if (m.far.length > 0 || cur === undefined) {
    body.push(header(cur === undefined ? (wide ? t('page.decide.sec_far_wide') : t('page.decide.sec_far_empty')) : wide ? t('page.decide.sec_far_wide') : t('page.decide.sec_far'), wide))
    if (m.far.length === 0) body.push([seg(GLYPHS.state.pending + ' '), dimSeg(t('page.decide.far_none'))])
    for (const f of m.far) {
      const to = wide && f.seat !== '' ? t('page.decide.far_to', { seat: f.seat }) : t('page.decide.far_to_c')
      const suffix = ' ' + GLYPHS.structure.answer + ' ' + to
      const prefix = (wide ? '  ' : '') + f.id + (wide ? '  ' : ' ')
      const maxTitle = Math.max(4, ctx.size.cols - displayWidth(prefix) - displayWidth(suffix))
      body.push(truncateSegs([seg(prefix + truncateToWidth(f.title, maxTitle) + suffix)], ctx.size.cols))
    }
  }

  // what the owner has to do or look at
  if (m.steps.length > 0) {
    body.push(header(t('page.decide.sec_steps'), wide))
    for (const s of m.steps) {
      const text = s.title ?? s.question
      body.push(truncateSegs(wide ? [seg('  '), dimSeg(s.kind === 'look' ? t('page.decide.look') : t('page.decide.step')), seg('  ' + text)] : [seg(text)], ctx.size.cols))
    }
  }

  // the action area: the state of the focused card, then the keys that work now
  if (cur !== undefined) actions.push(...actionRows(cur, cursor, nav, ctx, wide, roomy, total))
  // W3: focus content and its detail controls take precedence over the other-card
  // list. h/l still visit every bus card (the title keeps its real position/total).
  const room = Math.max(0, ctx.size.rows - 1 - (ctx.size.cols < STRIP_SPLIT_COLS ? 2 : 1) - actions.length)
  if (body.length > room && focusEnd < room) {
    const hidden = body.length - room + 1
    return { body: [...body.slice(0, Math.max(0, room - 1)), [dimSeg(ctx.t('frame.more', { n: hidden, arrow: GLYPHS.structure.behind }))]], actions }
  }
  return { body: body.slice(0, room), actions }
}

// W3: reserve one action row. Options stay in the body and undo exists only
// during a real hold; verbose explanations belong to the card, not the controls.
function actionRows(cur: Item, _cursor: number, nav: DecideNav, ctx: PageCtx, wide: boolean, _roomy: boolean, total = 1): Row[] {
  const { t } = ctx
  const R = (...parts: string[]): Row[] => [[seg(parts.filter(Boolean).join(' '))]]
  const navKeys = t('page.decide.act_nav_c')
  const fold = nav.folded ? t('page.decide.act_fold_open_c') : t('page.decide.act_fold_close_c')
  if (cur.kind === 'con') return R(t('page.decide.act_readonly', { seat: cur.c.executor_display ?? '-' }), navKeys, total > 1 ? fold : '')
  const d = cur.d
  const sent = d.id !== null && nav.sent[d.id] !== undefined && nav.fixing?.[d.id] === undefined
  const hold = d.id === null ? undefined : nav.hold?.[d.id]
  const pick = decidePick(d, nav)
  const k = pick === null ? '' : letterOf(pick)
  if (hold !== undefined) {
    const left = Math.max(0, Math.ceil((hold + DECIDE_UNDO_MS - ctx.nowMs) / 1000))
    return R(t('page.decide.act_held', { k, n: left }), navKeys)
  }
  if (sent) return R(t('page.decide.act_sent', { k }), navKeys)
  if (nav.textMode) return R(t('page.decide.act_text'), t('page.decide.act_text_keys'))
  if (decideDialog(d)) return R(navKeys)
  return R(k === '' ? '' : GLYPHS.structure.answer + ' ' + k, t('page.decide.act_note_c'), t('page.decide.act_send_c'), navKeys,
    total > 1 ? fold : '', t('page.decide.act_fill_c')) // V3: folding never replaces filling.
}

// ---- v7.4 S3: every card top to bottom; only the card at the cursor has Buttons (a/b/c, m); the others are plain text ----
const DOT = '·'
const CARET = '_'
const ruleTo = (text: string, cols: number): Row => [dimSeg(text + ' ' + GLYPHS.structure.rule.repeat(Math.max(0, cols - displayWidth(text) - 1)))]
const THREE = PICK_KEYS.length

// Minimal s2/feed trace extension: read optional error and card open-time metadata without blocking on s2's V74Ctx/DecideCard edit.
type V74DecideTrace = { decideError?: string | null; errors?: { decide?: string | null } }
type DecideCardMeta = DecideCard & { openedAtMs?: number | null; opened_at?: string | null; source?: string | null }

function decideAgeDuration(t: PageCtx['t'], ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return t('page.now.age_s', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('page.now.age_m', { n: m })
  const h = Math.floor(m / 60)
  return h < 24 ? t('page.now.age_h', { n: h }) : t('page.now.age_d', { n: Math.floor(h / 24) })
}

function v74CardAgeText(c: DecideCard, ctx: PageCtx): string {
  const mc = c as DecideCardMeta
  let atMs: number | null = typeof mc.openedAtMs === 'number' && Number.isFinite(mc.openedAtMs) ? mc.openedAtMs : null
  if (atMs === null && typeof mc.opened_at === 'string') {
    const parsed = Date.parse(mc.opened_at)
    if (Number.isFinite(parsed)) atMs = parsed
  }
  if (atMs === null && ctx.live !== null) {
    const match = ctx.live.pending.find(d => d.id === c.id)
    if (match !== undefined) atMs = openedMs(match, ctx)
  }
  if (atMs === null) return ''
  const age = ageOf(ctx, atMs)
  return age === '' ? '' : ctx.t('trace.card_age', { age })
}

function v74StaleBanners(ctx: PageCtx): Row[] {
  const { t, nowMs, size, live } = ctx
  const cols = Math.max(8, size.cols)
  const out: Row[] = []
  const decideFetched = ctx.v74?.ages?.decide ?? null
  if (decideFetched !== null) {
    const ageMs = Math.max(0, nowMs - decideFetched)
    if (ageMs > TRACE_STALE_MS) {
      out.push(...brokenRows(GLYPHS.state.failed + ' ' + t('trace.decide_feed_stale', { age: decideAgeDuration(t, ageMs), limit: TRACE_STALE_MIN }), cols))
    }
  }
  if (live !== null && live.state === 'stale') {
    const why = live.header.trim() !== '' ? live.header : live.state
    out.push(...brokenRows(GLYPHS.state.failed + ' ' + t('trace.decide_live_stale', { why, limit: TRACE_STALE_MIN }), cols))
  } else if (decideFetched === null && live !== null && live.state === 'ok') {
    const liveAge = liveAgeMs(live, nowMs)
    if (liveAge !== null && liveAge > TRACE_STALE_MS) {
      out.push(...brokenRows(GLYPHS.state.failed + ' ' + t('trace.decide_live_age', { age: decideAgeDuration(t, liveAge), limit: TRACE_STALE_MIN }), cols))
    }
  }
  return out
}

function v74Card(c: DecideCard, i: number, selected: boolean, nav: DecideNav, ctx: PageCtx, picks: Record<string, number>, notes: Record<string, string>): Row[] {
  const { t } = ctx
  const cols = ctx.size.cols
  const out: Row[] = []
  const keys = pickKeys(c.options)
  const mark = selected ? CURSOR_MARK : ' '
  const title = seg(c.title, selected ? { here: true } : {})
  const box = ctx.box === true
  const cardAge = v74CardAgeText(c, ctx)
  const ageTail: Seg[] = cardAge === '' ? [] : [dimSeg(' ' + DOT + ' ' + cardAge)]
  // The band frame has no host Pane. Each card head is a Button keyed card:N so the host's spatial up/down
  // (a focused Button consumes arrows; they never become ui.scroll while the frame is shorter than the viewport)
  // lands on the next card and ui.focus reports that key. Only the selected ▸ takes autoFocus.
  // The selected head is not a Button. A focused Button consumes Down/Up and re-fires onPress
  // with its own card:N, so the cursor event writes the index the ▸ already has.
  const head = selected
    ? [seg(mark, { color: PALETTE.here }), seg('  ' + String(i + 1) + '. '), title, ...tailSegs(c), ...ageTail]
    : [seg(mark + '  ' + String(i + 1) + '. ', box ? { press: 'card:' + i } : {}), title, ...tailSegs(c), ...ageTail]
  out.push(box ? head : truncateSegs(head, cols))
  const bg = c.background
  // J1: the real Pane draws cards through this path (not boxOpen): the open card's background is shown in full (one row per line, wrapped on the label's hanging indent, never cut), the frame scrolls it; the other cards keep one cut row
  if (!bg) { /* no background: no row (operator ruling 01M8879S) */ }
  else if (selected) out.push(...labelledBox(t('v74.d.bg'), bg, cols))
  else { const first = bg.split('\n')[0]; out.push(box ? [seg('    '), dimSeg(t('v74.d.bg')), seg('   ' + first)] : truncateSegs([seg('    '), dimSeg(t('v74.d.bg')), seg('   ' + first)], cols)) }
  const picked = picks[c.id]
  const held = nav.hold?.[c.id] !== undefined
  const sent = nav.sent[c.id] !== undefined && nav.fixing?.[c.id] === undefined
  const room = Math.max(4, Math.floor(cols / 2))
  c.options.forEach((o, k) => {
    const rec = o.recommended ? ' ' + GLYPHS.structure.recommend : ''
    const markPick = picked === k ? ' ' + GLYPHS.structure.answer : ''
    const tone = picked === k ? pickedTone() : o.recommended ? { color: PALETTE.attention } : {}
    if (box && k > 0) out.push([seg('')])
    if (!selected || k >= THREE || box) {
      const text = selected && k < THREE ? keys[k] + ': ' + o.label + rec + markPick : truncateToWidth(o.label, room) + rec + markPick
      const row = selected && k < THREE
        ? [seg('      '), seg(text, tone)]
        : [seg('      ' + DOT + ' '), seg(text, tone)]
      out.push(box ? row : truncateSegs(row, cols))
      return
    }
    const press = 'key:' + keys[k]
    const label = keys[k] + ': ' + truncateToWidth(o.label, room) + rec + markPick
    const pad = ' '.repeat(Math.max(2, 14 - displayWidth(label)))
    out.push(truncateSegs([seg('      '), seg(label, { press, ...tone }), ...(o.detail === '' ? [] : [seg(pad), dimSeg(o.detail)])], cols))
  })
  if (held) out.push([seg('      '), dimSeg(t('v74.d.held', { k: picked === undefined ? '-' : pickDigit(c, picked) }))])
  else if (sent) out.push([seg('      '), dimSeg(t('v74.d.sent'))])
  const note = notes[c.id] ?? ''
  const noteText = selected && nav.textMode ? nav.textBuf + CARET : note === '' ? t('v74.d.note_empty') : note
  const noteRow = selected
    ? [seg('      '), seg('m ' + t('v74.d.note'), box ? {} : { press: 'key:m' }), seg(noteText)]
    : [seg('      ' + t('v74.d.note')), seg(noteText)]
  out.push(box ? noteRow : truncateSegs(noteRow, cols))
  return out
}

// ---- r8: the band frame's 待決 (design S3). The cards other than the one at the cursor are one summary row each (the answer picked, else the one suggested); the card at the cursor is open
// in full: background on a hanging indent, then each option with its description, then the note. Spare rows keep the design's blank lines; a short frame drops them (then the descriptions) before it cuts.
const BOX_LABEL_HANG = 11 // `    背景   `: 4 blanks + the label (2 wide chars = 4 cells) + 3 blanks. The text of the first row starts here and every continuation row starts on the same cell (r8-3 #3)
// I2: the Pane is the full view: a background with line breaks is one row per line (80 lines are 80 rows), the frame scrolls what does not fit (PgUp / PgDn, 還有 N 列); the band keeps its truncation
const labelledBox = (label: string, text: string, width: number): Row[] => text.split('\n').flatMap((ln, k) => k === 0
  ? wrapRow([seg('    '), dimSeg(label), seg('   ' + ln)], width, BOX_LABEL_HANG)
  : wrapRow([seg(' '.repeat(BOX_LABEL_HANG) + ln)], width, BOX_LABEL_HANG))
function boxSummary(c: DecideCard, i: number, nav: DecideNav, ctx: PageCtx): Row {
  const { t } = ctx
  const picked = nav.picks[c.id]
  const held = nav.hold?.[c.id] !== undefined
  const sent = nav.sent[c.id] !== undefined && nav.fixing?.[c.id] === undefined
  const recIx = c.options.findIndex(o => o.recommended)
  const tail = sent ? t('v74.d.sent') : held ? t('v74.d.sum_held') : picked !== undefined && c.options[picked] !== undefined
    ? t('v74.d.sum_pick', { k: pickDigit(c, picked), label: c.options[picked].label })
    : recIx >= 0 ? t('v74.d.sum_rec', { label: c.options[recIx].label }) : ''
  const lead = '   ' + String(i + 1) + '. '
  const q = c.title + questionAfterTitle(c.title, c.question)
  const tailText = tail === '' ? '' : '  ' + DOT + ' ' + tail
  const room = ctx.size.cols - displayWidth(lead) - displayWidth(tailText)
  return [seg(lead, { press: 'card:' + i }), seg(displayWidth(q) <= room ? q : truncateToWidth(q, Math.max(4, room))), ...(tailText === '' ? [] : [dimSeg(tailText)])]
}
// The open card in the order the design draws it. `Fit` says what the frame can still afford; renderBoxV74 takes things away in this order when the frame is short:
// the loose blank lines (after the head, after the background, before the note), then the other cards' summaries collapse to one row per side, then the blank lines between
// options, and the option descriptions go last (r8 gate: `a:` and `b:` keep the blank row between them as long as anything does).
type Fit = { loose: boolean; collapse: boolean; between: boolean; desc: boolean }
const FIT_STEPS: Fit[] = [
  { loose: true, collapse: false, between: true, desc: true },
  { loose: false, collapse: false, between: true, desc: true },
  { loose: false, collapse: true, between: true, desc: true },
  { loose: false, collapse: true, between: false, desc: true },
  { loose: false, collapse: true, between: false, desc: false },
]
function boxOpen(c: DecideCard, i: number, nav: DecideNav, ctx: PageCtx, fit: Fit): Row[] {
  const { t } = ctx
  const width = Math.min(80, ctx.size.cols)
  const gap = fit.loose ? [[seg('')]] : []
  const keys = pickKeys(c.options)
  const picked = nav.picks[c.id]
  const held = nav.hold?.[c.id] !== undefined
  const sent = nav.sent[c.id] !== undefined && nav.fixing?.[c.id] === undefined
  const heading = wrapRow([seg(CURSOR_MARK, { color: PALETTE.here }), seg('  ' + String(i + 1) + '. '), seg(c.title, { here: true }), ...tailSegs(c)], ctx.pendingScroll === undefined ? ctx.size.cols : width, 5)
  const out: Row[] = [...(ctx.pendingScroll === undefined ? heading.slice(0, 1) : heading), ...gap]
  if (c.background) out.push(...labelledBox(t('v74.d.bg'), c.background, width), ...gap)
  c.options.forEach((o, k) => {
    if (k > 0 && fit.between) out.push([seg('')])
    const mark = picked === k ? ' ' + GLYPHS.structure.answer : ''
    const tone = picked === k ? pickedTone() : o.recommended ? { color: PALETTE.attention } : {}
    const label = (k < THREE ? keys[k] + ': ' : DOT + ' ') + o.label
    const rec = o.recommended ? [seg('  ' + GLYPHS.structure.recommend + ' ' + t('v74.d.rec'), { color: PALETTE.attention })] : []
    out.push([seg('    '), seg(label + mark, { ...tone, ...(ctx.pendingScroll !== undefined && !held && !sent && k < THREE ? { press: 'key:' + keys[k] } : {}) }), ...rec])
    if (o.detail !== '' && fit.desc) out.push(...wrapRow([seg('       '), dimSeg(o.detail)], width, 7))
  })
  if (held) out.push([seg('    '), dimSeg(t('v74.d.held', { k: picked === undefined ? '-' : pickDigit(c, picked) }))])
  else if (sent) out.push([seg('    '), dimSeg(t('v74.d.sent'))])
  const note = nav.notes[c.id] ?? ''
  const noteText = nav.textMode ? nav.textBuf + CARET : note === '' ? t('v74.d.note_empty') : note
  out.push(...gap, [seg('    m ' + t('v74.d.note')), seg(noteText)])
  return out
}

// The host Pane keeps a card's complete text in its own vertical window. Actions
// remain outside this body and frameRows always places them above the footer.
function pendingBody(ctx: PageCtx, cards: DecideCard[], nav: DecideNav, cursor: number, room: number): Row[] {
  const state = ctx.pendingScroll!
  const width = Math.min(80, ctx.size.cols) - 1
  const listRows = Math.min(cards.length, 8, Math.max(1, Math.floor(room / 2) - 1))
  keyedGrow(state.list, cards.map(c => c.id))
  if (state.cursor !== cards[cursor].id) {
    if (cursor < state.list.offset || cursor >= state.list.offset + listRows) state.list.offset = Math.floor(cursor / listRows) * listRows
    state.cursor = cards[cursor].id
  }
  const list = fixedWindow(cards.length, listRows, state.list)
  const queue: Row[] = [[dimSeg(ctx.t('page.decide.range', { a: list.offset + 1, b: list.offset + list.rows, n: cards.length }) + (ctx.box === true ? ' · ' + ctx.t('v74.d.head', { n: cards.length, k: cursor + 1 }) : ''))],
    ...cards.slice(list.offset, list.offset + list.rows).map((c, k) => {
      const at = list.offset + k
      const row = truncateSegs(boxSummary(c, at, nav, { ...ctx, size: { ...ctx.size, cols: width } }).map(s => ({ ...s, text: s.text.replace(/\s/g, ' ') })), width)
      return at === cursor ? row.map(s => ({ ...s, color: PALETTE.here, text: s === row[0] ? CURSOR_MARK + s.text.slice(1) : s.text })) : row
    }),
  ]
  if (list.hint) queue.push([dimSeg([
    list.above > 0 ? ctx.t('page.decide.more_up', { n: list.above, arrow: GLYPHS.structure.up }) + ctx.t('shell.scroll_key_up') : '',
    list.below > 0 ? ctx.t('page.decide.more_down', { n: list.below, arrow: GLYPHS.structure.behind }) + ctx.t('shell.scroll_key_down') : '',
  ].filter(Boolean).join('  '))])
  room = Math.max(1, room - queue.length)
  const model = state.detail
  keyed(model, cards[cursor].id)
  const full = boxOpen(cards[cursor], cursor, nav, { ...ctx, size: { ...ctx.size, cols: width } }, { loose: false, collapse: false, between: true, desc: true }).flatMap(row => wrapRow(row, width, 5))
  const win = fixedWindow(full.length, Math.max(1, room - (full.length > room ? 1 : 0)), model)
  const thumb = thumbOf(full.length, win.rows, win.offset)
  const shown = full.slice(win.offset, win.offset + win.rows).map((row, i) => {
    if (thumb === null) return row
    const on = i >= thumb.top && i < thumb.top + thumb.len
    return [...row, seg(' '.repeat(Math.max(0, width - row.reduce((n, s) => n + displayWidth(s.text), 0)))), seg(on ? GLYPHS.scrollbar.thumb : GLYPHS.scrollbar.track, { color: on ? PALETTE.here : PALETTE.structure })]
  })
  if (win.hint) shown.push([dimSeg([
    win.above > 0 ? GLYPHS.structure.up + ' ' + ctx.t('shell.more_up', { n: win.above }) : '',
    win.below > 0 ? GLYPHS.structure.behind + ' ' + ctx.t('shell.more_down', { n: win.below }) : '',
  ].filter(Boolean).join('  '))])
  return [...queue, ...shown]
}
// The card at the cursor is the open one, at its own place in the list; every other card keeps its order as one summary row. `collapse` folds the cards before it and the cards after it into
// one row each (`另有 N 張 · ↑↓ 換張`).
function boxBody(ctx: PageCtx, cards: DecideCard[], nav: DecideNav, cursor: number, fit: Fit, head: Row): Row[] {
  // r10b #3: a collapsed row keeps the answers already picked in it, so a pick never disappears from the screen
  const more = (hidden: DecideCard[], from: number): Row[] => {
    if (hidden.length === 0) return []
    const p = hidden.filter(c => nav.picks[c.id] !== undefined).length
    const ud = GLYPHS.structure.up + GLYPHS.structure.behind
    const base = '   ' + (p === 0 ? ctx.t('v74.d.more', { n: hidden.length, ud }) : ctx.t('v74.d.more_picked', { n: hidden.length, p, ud }))
    // r11 #10: name the hidden cards by the number they are drawn with (ids share long prefixes), `→letter` for a picked one, cut to what the row still has
    let list = ''
    const room = ctx.size.cols - 4 - displayWidth(base) - 3
    for (const [k, c] of hidden.entries()) {
      const at = nav.picks[c.id]
      const one = String(from + k + 1) + (at === undefined ? '' : GLYPHS.structure.answer + pickLetter(c, at))
      const next = list === '' ? one : list + ' ' + one
      if (displayWidth(next) > room) { list += '…'; break }
      list = next
    }
    return [[seg(base), ...(list === '' || room <= 0 ? [] : [dimSeg(' ' + DOT + ' ' + list)])]]
  }
  if (fit.collapse) return [head, ...more(cards.slice(0, cursor), 0), ...boxOpen(cards[cursor], cursor, nav, ctx, fit), ...more(cards.slice(cursor + 1), cursor + 1)]
  return [head, ...cards.flatMap((c, i) => (i === cursor ? boxOpen(c, i, nav, ctx, fit) : [boxSummary(c, i, nav, ctx)]))]
}
function renderBoxC(ctx: PageCtx, cards: DecideCard[], nav: DecideNav, cursor: number, actions: Row[], topBanners: Row[] = []): { body: Row[]; actions: Row[] } {
  const { t } = ctx
  const cols = ctx.size.cols
  const c = cards[cursor]
  const cardAge = v74CardAgeText(c, ctx)
  const ageSuffix = cardAge === '' ? '' : ' ' + DOT + ' ' + cardAge
  const innerRows = Math.max(1, ctx.size.rows - 1 - (cols < STRIP_SPLIT_COLS ? 2 : 1) - 1)
  const effActions = innerRows <= 2 ? [] : actions
  const room = Math.max(1, innerRows - effActions.length - topBanners.length)
  if (nav.bgOpen === true) {
    const width = Math.max(20, Math.min(80, cols) - 1)
    const countRow: Row = [dimSeg(t('v74.d.c_count', { k: cursor + 1, n: cards.length }) + ageSuffix)]
    const full = labelledBox(t('v74.d.bg'), c.background ?? '', width).flatMap(r => wrapRow(r, width, BOX_LABEL_HANG))
    const bgRoom = Math.max(1, ctx.size.rows - 1 - (cols < STRIP_SPLIT_COLS ? 2 : 1) - 1 - 1 - topBanners.length)
    if (ctx.pendingScroll !== undefined) {
      const model = ctx.pendingScroll.detail
      keyed(model, c.id + ':bg')
      const win = fixedWindow(full.length, Math.max(1, bgRoom - (full.length > bgRoom ? 1 : 0)), model)
      const thumb = thumbOf(full.length, win.rows, win.offset)
      const shown = full.slice(win.offset, win.offset + win.rows).map((row, i) => {
        if (thumb === null) return row
        const on = i >= thumb.top && i < thumb.top + thumb.len
        return [...row, seg(' '.repeat(Math.max(0, width - row.reduce((n, s) => n + displayWidth(s.text), 0)))), seg(on ? GLYPHS.scrollbar.thumb : GLYPHS.scrollbar.track, { color: on ? PALETTE.here : PALETTE.structure })]
      })
      if (win.hint) shown.push([dimSeg([
        win.above > 0 ? GLYPHS.structure.up + ' ' + t('shell.more_up', { n: win.above }) : '',
        win.below > 0 ? GLYPHS.structure.behind + ' ' + t('shell.more_down', { n: win.below }) : '',
      ].filter(Boolean).join('  '))])
      return { body: [...topBanners, countRow, ...shown], actions: [] }
    }
    return { body: [...topBanners, countRow, ...full.slice(0, bgRoom)], actions: [] }
  }
  const build = (between: boolean, desc: boolean, omitted: boolean, showBg = true): { rows: Row[]; headEnd: number } => {
    const keys = pickKeys(c.options)
    const countText = t('v74.d.c_count', { k: cursor + 1, n: cards.length }) + ageSuffix + (omitted ? ' ' + DOT + ' ' + t('v74.d.c_desc_omitted') : '')
    const out: Row[] = [[dimSeg(countText)]]
    out.push(...wrapRow([seg(CURSOR_MARK + '  '), seg(c.title, { color: PALETTE.here, here: true }), ...tailSegs(c)], cols, 3))
    if (showBg && c.background) {
      const bgRaw = c.background
      const bgLines = bgRaw.split('\n')
      const bgFirst = bgLines[0]
      const expandHint = '  ' + DOT + ' ' + t('v74.d.c_expand')
      const bgLabel = '  ' + t('v74.d.bg') + '  '
      const bgLabelW = displayWidth(bgLabel)
      const hasMoreBg = bgLines.length > 1 || displayWidth(bgFirst) > cols - bgLabelW
      if (hasMoreBg) {
        const bgAvail = Math.max(4, cols - bgLabelW - displayWidth(expandHint))
        const bgLine = displayWidth(bgFirst) <= bgAvail ? bgFirst : truncateToWidth(bgFirst, bgAvail)
        out.push([dimSeg(bgLabel), seg(bgLine), dimSeg(expandHint)])
      } else {
        out.push([dimSeg(bgLabel), seg(bgFirst)])
      }
    }
    const headEnd = out.length
    const picked = nav.picks[c.id]
    const held = nav.hold?.[c.id] !== undefined
    const sent = nav.sent[c.id] !== undefined && nav.fixing?.[c.id] === undefined
    c.options.forEach((o, k) => {
      if (k > 0 && between) out.push([seg('')])
      const mark = picked === k ? ' ' + GLYPHS.structure.answer : ''
      const tone = picked === k ? pickedTone() : o.recommended ? { color: PALETTE.attention } : {}
      const label = (k < THREE ? keys[k] + ': ' : DOT + ' ') + o.label
      const rec = o.recommended ? [seg('  ' + GLYPHS.structure.recommend + ' ' + t('v74.d.rec'), { color: PALETTE.attention })] : []
      out.push([seg('  '), seg(label + mark, { ...tone, ...(ctx.pendingScroll !== undefined && !held && !sent && k < THREE ? { press: 'key:' + keys[k] } : {}) }), ...rec])
      if (o.detail !== '' && desc) out.push(...wrapRow([seg('     '), dimSeg(o.detail)], cols, 5))
    })
    if (held) out.push([seg('  '), dimSeg(t('v74.d.held', { k: picked === undefined ? '-' : pickDigit(c, picked) }))])
    else if (sent) out.push([seg('  '), dimSeg(t('v74.d.sent'))])
    const note = nav.notes[c.id] ?? ''
    const noteText = nav.textMode ? nav.textBuf + CARET : note === '' ? t('v74.d.note_empty') : note
    if (showBg || out.length + 1 <= room) out.push([seg('  m ' + t('v74.d.note')), seg(noteText)])
    return { rows: out, headEnd }
  }
  let body = build(true, true, false, true)
  if (body.rows.length > room) body = build(false, true, false, true)
  if (body.rows.length > room) body = build(false, false, true, true)
  if (body.rows.length > room) body = build(false, false, true, false)
  if (body.rows.length > room) {
    const picked = nav.picks[c.id]
    const held = nav.hold?.[c.id] !== undefined
    const sent = nav.sent[c.id] !== undefined && nav.fixing?.[c.id] === undefined
    const qRow = truncateSegs([
      seg(CURSOR_MARK + ' '),
      dimSeg(`(${cursor + 1}/${cards.length}) `),
      seg(c.title, { color: PALETTE.here, here: true }),
      ...tailSegs(c),
    ], cols)
    const optKeys = pickKeys(c.options)
    const optSegsOf = (o: DecideCard['options'][number], k: number): Seg[] => {
      const mark = picked === k ? ' ' + GLYPHS.structure.answer : ''
      const tone = picked === k ? pickedTone() : o.recommended ? { color: PALETTE.attention } : {}
      const label = (k < THREE ? optKeys[k] + ': ' : DOT + ' ') + o.label
      const rec = o.recommended ? [seg(' ' + GLYPHS.structure.recommend, { color: PALETTE.attention })] : []
      return [seg(label + mark, { ...tone, ...(ctx.pendingScroll !== undefined && !held && !sent && k < THREE ? { press: 'key:' + optKeys[k] } : {}) }), ...rec]
    }
    const stacked: Row[] = [qRow, ...c.options.map((o, k) => truncateSegs([seg('  '), ...optSegsOf(o, k)], cols))]
    if (stacked.length <= room) {
      body = { rows: stacked, headEnd: 1 }
    } else {
      const inlineOptRow = truncateSegs([
        seg('  '),
        ...c.options.flatMap((o, k) => (k === 0 ? optSegsOf(o, k) : [seg('   '), ...optSegsOf(o, k)])),
      ], cols)
      body = { rows: [qRow, inlineOptRow], headEnd: 1 }
    }
  }
  return { body: [...topBanners, ...body.rows], actions: effActions }
}

// Compact 1-row-per-card list for maxRows < 10 (PM 01M837ZECP): pressing a card expands it.
function renderBoxCompactList(ctx: PageCtx, cards: DecideCard[], nav: DecideNav, cursor: number, actions: Row[], topBanners: Row[] = []): { body: Row[]; actions: Row[] } {
  const { t } = ctx
  const cols = ctx.size.cols
  const room = Math.max(1, ctx.size.rows - 1 - (cols < STRIP_SPLIT_COLS ? 2 : 1) - 1 - actions.length - topBanners.length)
  const hasHead = room >= 2
  const listCap = hasHead ? room - 1 : room
  const maxOff = Math.max(0, cards.length - listCap)
  const offset = Math.max(0, Math.min(maxOff, cursor < listCap ? 0 : cursor - listCap + 1))
  const shown = cards.slice(offset, offset + listCap)
  const body: Row[] = [...topBanners]
  if (hasHead) {
    body.push(truncateSegs([dimSeg(t('v74.d.compact_hint', { k: cursor + 1, n: cards.length }))], cols))
  }
  shown.forEach((item, k) => {
    const idx = offset + k
    const isCur = idx === cursor
    const p = nav.picks[item.id]
    const hasRec = item.options.some(o => o.recommended)
    const mark = isCur ? CURSOR_MARK + ' ' : '  '
    const num = String(idx + 1).padStart(2, '0') + ' '
    const suffix = (hasRec ? ' ' + GLYPHS.structure.recommend : '') + (p !== undefined ? ' ' + GLYPHS.structure.answer + pickLetter(item, p) : ' ' + GLYPHS.state.pending)
    const titleRoom = Math.max(4, cols - displayWidth(mark + num + suffix))
    const title = truncateToWidth(item.title, titleRoom)
    const pad = ' '.repeat(Math.max(0, cols - displayWidth(mark + num + title + suffix)))
    const row: Row = isCur
      ? [seg(CURSOR_MARK, { color: PALETTE.here }), seg(' ' + num + title, { here: true, press: 'card:' + idx }), dimSeg(pad + suffix)]
      : [seg(mark + num + title, { press: 'card:' + idx }), dimSeg(pad + suffix)]
    body.push(padRowTo(row, cols))
  })
  return { body, actions }
}
function padRowTo(row: Row, width: number): Row {
  const cut = widthOf(row) > width ? truncateSegs(row, width) : row
  const w = widthOf(cut)
  return w >= width ? cut : [...cut, seg(' '.repeat(width - w))]
}

function renderBoxD(ctx: PageCtx, cards: DecideCard[], nav: DecideNav, cursor: number, actions: Row[], topBanners: Row[] = []): { body: Row[]; actions: Row[] } {
  const { t } = ctx
  const cols = ctx.size.cols
  const c = cards[cursor]
  const cardAge = v74CardAgeText(c, ctx)
  const ageSuffix = cardAge === '' ? '' : ' ' + DOT + ' ' + cardAge
  const room = Math.max(1, ctx.size.rows - 1 - (cols < STRIP_SPLIT_COLS ? 2 : 1) - 1 - actions.length - topBanners.length)
  const picked = nav.picks[c.id]
  const held = nav.hold?.[c.id] !== undefined
  const sent = nav.sent[c.id] !== undefined && nav.fixing?.[c.id] === undefined
  const recIx = c.options.findIndex(o => o.recommended)
  const statusText = sent ? t('v74.d.sent') : held ? t('v74.d.sum_held') : picked !== undefined ? `${GLYPHS.structure.answer} ${pickLetter(c, picked)}` : GLYPHS.state.pending
  const recText = recIx >= 0 ? ` · ${GLYPHS.structure.recommend} ${pickLetter(c, recIx)}` : ''
  const single = cards.length === 1

  // Build right-pane detail lines for `c` in operator order (UX gate §14, matching single-card C): title -> background -> options -> note.
  // Option buttons use `a: label` (3-cell prefix) to match the host hotkey draw width so the right-edge scrollbar aligns on every row.
  const buildDetail = (detailW: number): Row[] => {
    const innerW = Math.max(10, detailW - 2)
    const keys = pickKeys(c.options)
    const out: Row[] = []
    out.push(...wrapRow([seg(c.title, { here: true }), ...tailSegs(c)], innerW, 2))
    if (c.background) { out.push(...labelledBox(t('v74.d.bg'), c.background, innerW)); out.push([seg('')]) }
    c.options.forEach((o, k) => {
      if (k > 0) out.push([seg('')])
      const mark = picked === k ? ' ' + GLYPHS.structure.answer : ''
      const tone = picked === k ? pickedTone() : o.recommended ? { color: PALETTE.attention } : {}
      const keyLabel = (k < PICK_KEYS.length ? keys[k] : letterOf(k))
      const rec = o.recommended ? [seg('  ' + GLYPHS.structure.recommend + ' ' + t('v74.d.rec'), { color: PALETTE.attention })] : []
      out.push(...wrapRow([seg('  '), seg(`${keyLabel}: ${o.label}${mark}`, { ...tone, ...(ctx.pendingScroll !== undefined && !held && !sent && k < PICK_KEYS.length ? { press: 'key:' + keys[k] } : {}) }), ...rec], innerW, 6))
      if (o.detail !== '') out.push(...wrapRow([seg('      '), dimSeg(o.detail)], innerW, 6))
    })
    if (held) out.push([seg('  '), dimSeg(t('v74.d.held', { k: picked === undefined ? '-' : pickDigit(c, picked) }))])
    else if (sent) out.push([seg('  '), dimSeg(t('v74.d.sent'))])
    const note = nav.notes[c.id] ?? ''
    const noteText = nav.textMode ? nav.textBuf + CARET : note === '' ? t('v74.d.note_empty') : note
    out.push(...wrapRow([seg('  m ' + t('v74.d.note')), seg(noteText)], innerW, 6))
    return out
  }

  const scrollDetail = (detailRows: Row[], detailW: number, visRows: number, padToVis = true): Row[] => {
    const textW = Math.max(1, detailW - 1)
    if (ctx.pendingScroll === undefined) {
      const count = padToVis ? visRows : Math.min(visRows, detailRows.length)
      return Array.from({ length: count }, (_, i) => padRowTo(detailRows[i] ?? [seg('')], detailW))
    }
    const model = ctx.pendingScroll.detail
    keyed(model, c.id)
    const needHint = detailRows.length > visRows
    const win = fixedWindow(detailRows.length, Math.max(1, visRows - (needHint ? 1 : 0)), model)
    const thumb = thumbOf(detailRows.length, win.rows, win.offset)
    const shown: Row[] = []
    for (let i = 0; i < win.rows; i++) {
      const row = detailRows[win.offset + i] ?? [seg('')]
      if (thumb === null) {
        shown.push(padRowTo(row, detailW))
      } else {
        const on = i >= thumb.top && i < thumb.top + thumb.len
        shown.push([...padRowTo(row, textW), seg(on ? GLYPHS.scrollbar.thumb : GLYPHS.scrollbar.track, { color: on ? PALETTE.here : PALETTE.structure })])
      }
    }
    if (win.hint) {
      const hintText = [
        win.above > 0 ? GLYPHS.structure.up + ' ' + t('shell.more_up', { n: win.above }) : '',
        win.below > 0 ? GLYPHS.structure.behind + ' ' + t('shell.more_down', { n: win.below }) : '',
      ].filter(Boolean).join('  ')
      shown.push(padRowTo([dimSeg(hintText)], detailW))
    }
    if (padToVis) {
      while (shown.length < visRows) shown.push(padRowTo([seg('')], detailW))
    }
    return shown
  }

  if (single) {
    const headRow: Row = truncateSegs([dimSeg(`${ctx.t('v74.d.card_single')} · ${statusText}${recText}${ageSuffix}`)], cols)
    const sepRow: Row = [dimSeg(GLYPHS.structure.rule.repeat(cols))]
    const midRoom = Math.max(1, room - 2)
    const detailRows = buildDetail(cols)
    const rightShown = scrollDetail(detailRows, cols, midRoom, false)
    return { body: [...topBanners, headRow, sepRow, ...rightShown], actions }
  }

  const listWant = cards.reduce((m, x) => {
    const hasRec = x.options.some(o => o.recommended)
    return Math.max(m, displayWidth('  00 ' + x.title) + 2 + (hasRec ? 2 : 0))
  }, 0)
  const { leftW, rightW } = decideColumnWidths(cols, listWant)
  const midRoom = Math.max(1, room - 2)

  // Left + Right header
  const leftHead = padRowTo([dimSeg(leftW >= 34 ? ctx.t('v74.d.list_long', { n: cards.length }) : ctx.t('v74.d.list_short', { n: cards.length }))], leftW)
  const rightHead = padRowTo([dimSeg(`${ctx.t('v74.d.card_of', { k: String(cursor + 1).padStart(2, '0'), n: cards.length })} · ${statusText}${recText}${ageSuffix}`)], rightW)
  const headRow: Row = [...leftHead, dimSeg(' ' + GLYPHS.structure.bandSep + ' '), ...rightHead]
  const sepRow: Row = [dimSeg(GLYPHS.structure.rule.repeat(leftW + 1) + GLYPHS.structure.bandSep + GLYPHS.structure.rule.repeat(rightW + 1))]

  // Left pane with independent scroll + scrollMargin = 2.
  // Selected card is plain text (not a Button) so host Down/Up is not eaten as cursor-at-self (r7); non-selected cards carry card:N.
  const renderLeftRow = (item: DecideCard, idx: number): Row => {
    const isCur = idx === cursor
    const p = nav.picks[item.id]
    const hasRec = item.options.some(o => o.recommended)
    const mark = isCur ? CURSOR_MARK + ' ' : '  '
    const num = String(idx + 1).padStart(2, '0') + ' '
    const suffix = (hasRec ? ' ' + GLYPHS.structure.recommend : '') + (p !== undefined ? ' ' + GLYPHS.structure.answer + pickLetter(item, p) : ' ' + GLYPHS.state.pending)
    const titleRoom = Math.max(4, leftW - displayWidth(mark + num + suffix))
    const title = truncateToWidth(item.title, titleRoom)
    const pad = ' '.repeat(Math.max(0, leftW - displayWidth(mark + num + title + suffix)))
    const row: Row = isCur
      ? [seg(mark + num + title, { color: PALETTE.here, here: true }), seg(pad + suffix, { color: PALETTE.here })]
      : [seg(mark + num + title, { press: 'card:' + idx }), dimSeg(pad + suffix)]
    return padRowTo(row, leftW)
  }

  const leftShown: Row[] = []
  const needListHint = cards.length > midRoom && midRoom >= 2
  const listCap = needListHint ? midRoom - 1 : midRoom
  let listOffset = 0
  let listCount = Math.min(cards.length, listCap)
  let listAbove = 0
  let listBelow = 0
  if (ctx.pendingScroll !== undefined) {
    const listState = ctx.pendingScroll.list
    keyedGrow(listState, cards.map(x => x.id))
    const margin = Math.min(2, Math.floor(listCap / 3))
    if (ctx.pendingScroll.cursor !== c.id) {
      if (cursor < listState.offset + margin) listState.offset = Math.max(0, cursor - margin)
      else if (cursor >= listState.offset + listCap - margin) listState.offset = Math.max(0, cursor - listCap + margin + 1)
      ctx.pendingScroll.cursor = c.id
    }
    const listWin = fixedWindow(cards.length, listCap, listState)
    listOffset = listWin.offset
    listCount = listWin.rows
    listAbove = listWin.above
    listBelow = listWin.below
  } else {
    const maxOff = Math.max(0, cards.length - listCap)
    listOffset = Math.max(0, Math.min(maxOff, cursor < listCap ? 0 : cursor - listCap + 1))
    listCount = Math.min(cards.length - listOffset, listCap)
    listAbove = listOffset
    listBelow = Math.max(0, cards.length - listOffset - listCount)
  }
  for (let k = 0; k < listCount; k++) {
    leftShown.push(renderLeftRow(cards[listOffset + k], listOffset + k))
  }
  if (needListHint && (listAbove > 0 || listBelow > 0)) {
    const hiddenPicked = cards.filter((x, idx) => (idx < listOffset || idx >= listOffset + listCount) && nav.picks[x.id] !== undefined).length
    const pickedTail = hiddenPicked > 0 ? '（已選 ' + hiddenPicked + '）' : ''
    const hintStr = listAbove > 0 && listBelow > 0
      ? GLYPHS.structure.up + ' ' + listAbove + ' 張 ' + GLYPHS.structure.behind + ' ' + listBelow + ' 張' + pickedTail
      : [
          listAbove > 0 ? GLYPHS.structure.up + ' 上面還有 ' + listAbove + ' 張' : '',
          listBelow > 0 ? GLYPHS.structure.behind + ' 下面還有 ' + listBelow + ' 張' : '',
        ].filter(Boolean).join(' ') + pickedTail
    leftShown.push(padRowTo([dimSeg(hintStr)], leftW))
  }
  while (leftShown.length < midRoom) leftShown.push(padRowTo([seg('')], leftW))

  const detailRows = buildDetail(rightW)
  const rightShown = scrollDetail(detailRows, rightW, midRoom)

  const body: Row[] = [...topBanners, headRow, sepRow]
  for (let i = 0; i < midRoom; i++) {
    body.push([...leftShown[i], dimSeg(' ' + GLYPHS.structure.bandSep + ' '), ...rightShown[i]])
  }
  return { body, actions }
}

function renderBoxV74(ctx: DecideCtx, cards: DecideCard[], nav: DecideNav, cursor: number, actions: Row[], topBanners: Row[] = []): { body: Row[]; actions: Row[] } {
  const bodyCols = ctx.bodyColumns ?? ctx.size.cols
  const effMaxRows = ctx.maxRows ?? ctx.size.rows
  const mode = decideLayoutMode(bodyCols, nav.layoutMode ?? null)
  if (effMaxRows < DECIDE_COMPACT_MAX_ROWS) {
    return nav.compactExpanded === true
      ? renderBoxC(ctx, cards, nav, cursor, actions, topBanners)
      : renderBoxCompactList(ctx, cards, nav, cursor, actions, topBanners)
  }
  const singleCol = mode === 'single' || (nav.style ?? 'D') === 'C'
  if (singleCol) {
    return renderBoxC(ctx, cards, nav, cursor, actions, topBanners)
  }
  return renderBoxD(ctx, cards, nav, cursor, actions, topBanners)
}

// The card fields the owner reads, with Ambiguous-width characters swapped for ASCII (render time only; the cards themselves stay as sent).
const narrowCards = (ctx: DecideCtx): DecideCtx => {
  const v = ctx.v74
  if (v === undefined) return ctx
  const n = (s: string): string => narrowAmbiguous(s)
  const nn = (s: string | null): string | null => (s === null ? null : n(s))
  return { ...ctx, v74: { ...v,
    decide: v.decide === null ? null : v.decide.map(c => ({ ...c, title: n(c.title), question: n(c.question), background: nn(c.background), options: c.options.map(o => ({ ...o, label: n(o.label), detail: n(o.detail) })) })),
    awaiting: v.awaiting === undefined || v.awaiting === null ? v.awaiting : v.awaiting.map(a => ({ ...a, title: nn(a.title), question: n(a.question), operator_steps: a.operator_steps.map(n) })),
  } }
}

function renderV74(ctx0: DecideCtx): { body: Row[]; actions: Row[] } {
  const ctx = narrowCards(ctx0)
  const { t } = ctx
  const cols = ctx.size.cols
  const v = ctx.v74 as NonNullable<PageCtx['v74']>
  const cards = v.decide
  const staleBanners = v74StaleBanners(ctx)
  if (cards === null) {
    const decideErr = (v as V74DecideTrace).decideError?.trim() || (v as V74DecideTrace).errors?.decide?.trim() || ''
    const noSrcBody = decideErr !== ''
      ? brokenRows(GLYPHS.state.failed + ' ' + decideErr + '（fleet decision list）', Math.max(8, cols))
      : [brokenRow(GLYPHS.state.failed + ' ' + t('v74.d.no_source'))]
    // In v7.4 band box mode the obsolete `shell.on_band` pointer is dropped; non-box callers keep it for backward compatibility.
    const noSrcActions: Row[] = ctx.box === true ? [] : [[seg(t('shell.on_band'))]]
    return { body: [...staleBanners, ...noSrcBody], actions: noSrcActions }
  }
  if (cards.length === 0) return { body: [...staleBanners, [seg(GLYPHS.state.pending + ' '), dimSeg(t('v74.d.empty'))], ...awaitingBlockRows(v.awaiting, ctx, Math.max(awaitingBodyCap(ctx), ctx.size.rows - 4 - frameActionRows(ctx.size.rows)))], actions: [] }
  const dn = ctx.decide
  const nav: DecideNav = { ...NO_NAV, ...(dn ?? {}), cursor: dn?.cursor ?? v.nav.cursor, picks: dn?.picks ?? v.nav.picks, notes: dn?.notes ?? v.nav.notes, textMode: dn?.textMode ?? v.nav.noteMode }
  const cursor = Math.max(0, Math.min(cards.length - 1, nav.cursor))
  const ready = cards.filter(c => decideLine(cardToLive(c), nav) !== null && nav.hold?.[c.id] === undefined).length
  const left = cards.length - ready
  // `s` sends the picked cards only: say how many go and how many stay (nothing after the `·` when none stay)
  const sendText = '[s] ' + t('v74.d.send_all', { n: ready }) + (left > 0 ? ' ' + DOT + ' ' + t('v74.d.unpicked', { n: left }) : '')
  const actions: Row[] = [[seg(sendText, { press: 'key:s' })]]
  if (ctx.box === true) {
    const m = ctx.v74?.sendResult
    // r11 #3: after the first s the preview lists every card that goes out: number, title, letter, option name, note (cut by chars). Rows beyond the action area end in 「…另 N 張」.
    const plan = cards.flatMap((c, i) => {
      const at = decidePick(cardToLive(c), nav)
      if (decideLine(cardToLive(c), nav) === null || at === null || nav.hold?.[c.id] !== undefined) return []
      const cut = (x: string, n: number): string => { const a = [...x]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : x }
      const note = (nav.notes[c.id] ?? '').trim()
      const text = (i + 1) + '. ' + cut(c.title, 14) + ' ' + GLYPHS.structure.answer + ' ' + pickLetter(c, at) + ' ' + cut(c.options[at]?.label ?? '', 12) + (note === '' ? '' : ' ' + DOT + ' ' + t('v74.d.pv_note', { note: cut(note, 24) }))
      return [text]
    })
    const resultRow: Row[] = m === undefined || m === null ? [] : [[dimSeg(GLYPHS.state.done + ' ' + t('v74.d.result', { n: m.n, left: m.left }))] as Row]
    const full = frameActionRows(ctx.size.rows)
    const cap = Math.max(0, full - resultRow.length)
    const shown = plan.length + 1 <= cap ? plan : plan.slice(0, Math.max(0, cap - 2))
    const rest = plan.length - shown.length
    const previewRows: Row[] = [
      [seg(previewStale({ ...nav, snap: dn?.snap, stale: dn?.stale }, ctx) ? t('v75.stale') : t('v74.d.preview', { n: plan.length }), { press: 'key:y', color: PALETTE.attention })],
      ...shown.map(x => truncateSegs([seg('  ' + x)], cols)),
      ...(rest > 0 ? [[dimSeg('  ' + t('v74.d.pv_more', { n: rest }))] as Row] : []),
    ]
    const sendRows: Row[] = nav.armed === true && plan.length > 0 ? previewRows : [[seg(sendText, { press: 'key:s' })]]
    // 等你動手: the bottom of the body, directly above the action rows; the card box above gives way so the frame never cuts it
    const room = frameBodyRoom(ctx, sendRows.length + resultRow.length)
    const aw = awaitingBlockRows(v.awaiting, ctx, awaitingBodyCap(ctx, v.awaiting, room))
    // PM ruling 01M89BCVGB: the focused card's options are never left to a scroll. When the block hides one, it folds to its heading row.
    const drawn = (blk: Row[]): { body: Row[]; actions: Row[] } => {
      const boxed = renderBoxV74(shrunk(ctx, blk.length), cards, nav, cursor, [...sendRows, ...resultRow], staleBanners)
      return { body: blk.length === 0 ? boxed.body : [...frameWrap(boxed.body, ctx).slice(0, Math.max(0, room - blk.length)), ...blk], actions: boxed.actions }
    }
    const whole = drawn(aw)
    if (aw.length <= 1) return whole
    const folded = drawn(aw.slice(0, 1))
    return optionsShown(folded.body, cards[cursor]) > optionsShown(whole.body, cards[cursor]) ? folded : whole
  }
  const head = ruleTo(GLYPHS.structure.open + ' ' + t('v74.d.head', { n: cards.length, k: cursor + 1 }), cols)
  // 等你動手: at the bottom of the body, directly above the action rows (awaitingBodyCap)
  const aw = awaitingBlockRows(v.awaiting, ctx, awaitingBodyCap(ctx, v.awaiting, frameBodyRoom(ctx, actions.length)))
  if (ctx.pendingScroll !== undefined) {
    const room = Math.max(1, ctx.size.rows - 1 - 1 - (cols < STRIP_SPLIT_COLS ? 2 : 1) - actions.length - staleBanners.length - aw.length)
    return { body: [...staleBanners, ...pendingBody(ctx, cards, nav, cursor, room), ...aw], actions }
  }
  const blocks = cards.map((c, i) => [...v74Card(c, i, i === cursor, nav, ctx, nav.picks, nav.notes), [seg('')]])
  // a short allocation: leading cards go first so the selected one stays on screen (the frame cuts the tail)
  const room = Math.max(1, ctx.size.rows - 1 - (cols < STRIP_SPLIT_COLS ? 2 : 1) - actions.length - aw.length)
  let first = 0
  const total = (): number => 1 + staleBanners.length + blocks.slice(first).reduce((n, b) => n + b.length, 0)
  while (total() > room && first < cursor) first++
  const listed = [head, ...staleBanners, ...blocks.slice(first).flat()]
  if (aw.length === 0) return { body: listed, actions }
  // the frame cuts an overlong body at its tail, so with the 等你動手 block under the list the list is wrapped here the way the
  // frame wraps a reading page (min(80, cols), hanging indent) and cut to its room: the block is never the part that is dropped
  return { body: [...frameWrap(listed, ctx).slice(0, Math.max(0, frameBodyRoom(ctx, actions.length) - aw.length)), ...aw], actions }
}

export const decidePage: Page = { id: 'decide', key: '2', title: '待決', framed: true, render }
